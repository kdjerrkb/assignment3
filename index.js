class World {
    constructor(wnd) {
        this.window = wnd
        this.clock = new THREE.Clock()
        this.isLoading = true
        this.loader = THREE.DefaultLoadingManager
        this.onLoadedCallbacks = []
        this.loader.onLoad = () => {
            this.isLoading = false
            this.onLoadedCallbacks.forEach(cb => cb())
        }
        this.loader.onError = url => console.error(`There was an error loading ${url}`)

        this.setupRenderer()
        this.setupScene()
        this.setupLighting()

        // Auto resize engine
        wnd.addEventListener('resize', () => {
            this.renderer.setSize(wnd.innerWidth, wnd.innerHeight)
        })

        this.onRenderCallbacks = []
        this.animationMixers = []
        this.loadedFbx = {}
    }

    drawGridQuadrant(signX, signZ) {
        const GRID_SIZE = 10
        const GRID_N = 20

        const sX = signX > 0 ? 1 : -1
        const sZ = signZ > 0 ? 1 : -1
        for (let i=0; i<GRID_N; i++) {
            for (let j=0; j<GRID_N; j++) {
                const offX = i*GRID_SIZE*sX
                const offZ = j*GRID_SIZE*sZ
                const geo = new THREE.BufferGeometry()
                const verts = new Float32Array([
                    offX,            0,    offZ,
                    offX,            0,    offZ+GRID_SIZE,
                    offX+GRID_SIZE,  0,    offZ+GRID_SIZE,
                    offX+GRID_SIZE,  0,    offZ,
                    offX,            0,    offZ
                ])
                geo.addAttribute('position', new THREE.BufferAttribute(verts, 3))
                const mat = new THREE.LineBasicMaterial({ color: 0 })
                const line = new THREE.Line(geo, mat)
                this.scene.add(line)
            }
        }
    }

    setupRenderer() {
        const renderer = new THREE.WebGLRenderer({ alpha: true })
        renderer.setSize(this.window.innerWidth, this.window.innerHeight)
        this.renderer = renderer
        this.window.document.body.appendChild(renderer.domElement)
    }

    setupScene() {
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0xeeeeee)
        this.scene = scene
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
        this.scene.add(ambientLight)
        this.ambientLight = ambientLight

        const hemisphericLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5)
        hemisphericLight.position.y += 1500
        this.scene.add(hemisphericLight)
    }

    addAnimationMixer(mixer) {
        this.animationMixers.push(mixer)
    }

    loadFbx(name, filename, addToScene = false, cb = () => {}) {
        const fbxLoader = new THREE.FBXLoader(this.loader)
        fbxLoader.load(filename, object => {
            object.name = name
            if (this.loadedFbx[name]) {
                console.log(`Warning: overwriting existing FBX '${name}'!`)
            }
            this.loadedFbx[name] = object
            if (addToScene) this.scene.add(object)
            cb(null, object)
        }, xhr => {
            // console.log(xhr.loaded/xhr.total*100 + '% loaded')
        }, xhr => {
            const errMsg = `Error loading FBX '${name}': ${JSON.stringify(xhr)}!`
            console.error(errMsg)
            cb(new Error(errMsg), null)
        })
    }

    onLoaded(cb) {
        if (typeof cb !== 'function') {
            throw new Error(`${cb} must be a function!`)
        }

        if (this.isLoading) {
            this.onLoadedCallbacks.push(cb)
        } else {
            // Already loaded, invoke callback immediately
            cb()
        }
    }

    onRender(cb) {
        if (typeof cb !== 'function') {
            throw new Error(`${cb} must be a function!`)
        } else {
            this.onRenderCallbacks.push(cb)
        }
    }

    setCamera(camera) {
        this.camera = camera
    }

    teardown() {
        cancelAnimationFrame(this.animationFrameId)
        while (this.scene.children.length) {
            const child = this.scene.children[0]
            child.traverse(c => {
                if (typeof c.dispose === 'function') {
                    c.dispose()
                }
            })
            if (typeof child.dispose === 'function') {
                child.dispose()
            }
            this.scene.remove(child)
        }
        this.scene = null
        this.camera = null
        this.clock = null
        this.loader = null
        this.onLoadedCallbacks = null
        this.onRenderCallbacks = null
        this.animationMixers = null
        Object.keys(this.loadedFbx).forEach(key => {
            this.loadedFbx[key].traverse(child => {
                if (typeof child.dispose === 'function') {
                    child.dispose()
                }
            })
            this.loadedFbx[key] = null
            delete this.loadedFbx[key]
        })
        this.renderer.domElement.remove()
        this.renderer = null
    }

    render() {
        // Store the delta so it can be passed around (for consistency)
        const clockDelta = this.clock.getDelta()
        // Run animations
        this.animationMixers.forEach(mixer => mixer.update(clockDelta))
        // Run onRender subscriptions
        this.onRenderCallbacks.forEach(cb => cb(clockDelta))
        // Render current frame only if camera available
        if (this.camera) {
            this.renderer.render(this.scene, this.camera)
        } else {
            // console.error('No camera has been setup yet!')
        }
        // Next frame
        this.animationFrameId = requestAnimationFrame(() => this.render())
    }
}

class Player {
    constructor(world) {
        this.world = world
        this.speed = 100. // scalar, pos units per tick
        this.bearing = 0
        this.moveForward = true
        this.moveBackward = false
        this.moveLeft = false
        this.moveRight = false
        this.ROTATION_OFFSET_Y = 0
        this.dead = false

        this.attachControl()
        this.setupModel()
    }

    get position() {
        const model = this.model
        return model ? model.position : new THREE.Vector3(0, 0, 0)
    }

    setupModel() {
        const world = this.world

        world.loadFbx('player', './sources/player@skateboarding.fbx', true)
        world.loadFbx('playerDying', './sources/player@dying.fbx', false)
        world.loadFbx('snowboard', './sources/snowboard.fbx', true)

        world.onLoaded(() => {
            const player = world.loadedFbx['player']
            const playerDying = world.loadedFbx['playerDying']
            const snowboard = world.loadedFbx['snowboard']

            this.model = player
            let footBone
            player.traverse(child => {
                if (child.type === 'Bone' &&
                    child.name === 'mixamorigLeftFoot') {
                    footBone = child
                }
            })
            // Position camera, set the scale, etc
            snowboard.scale.set(4, 4, 4)
            footBone.add(snowboard)
            snowboard.rotateX(-2.1)
            snowboard.rotateZ(-0.6)
            snowboard.translateX(105)
            snowboard.translateZ(13)

            player.traverse(m => {
                if (m.type === 'SkinnedMesh' ||
                    m.type === 'Mesh') {
                    m.castShadow = true
                }
            })
            player.scale.set(0.1, 0.1, 0.1)
            player.rotation.x = Math.PI/48

            // Add the loaded animations to the base mesh
            // Name them for convenience
            player.animations[0].name = 'idle'
            playerDying.animations[0].name = 'dying'
            player.animations.push(...playerDying.animations)

            // Setup AnimationMixer for loaded model
            const mixer = new THREE.AnimationMixer(player)
            world.addAnimationMixer(mixer)
            this.animationMixer = mixer

            // Reset clip durations
            player.animations.forEach(clip => {
                clip.resetDuration()
            })

            // Play idle animation
            this.playAnimation('idle')

            world.onRender(clockDelta => this.move(clockDelta))
        })
    }

    attachControl(container = this.world.window) {
        let mouseDownRunning = false
        container.addEventListener('keydown', event => {
            switch (event.code) {
            case 'KeyW':
                this.moveForward = true
                this.moveBackward = false
                break
            case 'KeyS':
                // this.moveForward = false
                // this.moveBackward = true
                break
            case 'KeyA':
            case 'ArrowLeft':
                this.moveLeft = true
                this.moveRight = false
                break
            case 'KeyD':
            case 'ArrowRight':
                this.moveLeft = false
                this.moveRight = true
                break
            }
        })
        container.addEventListener('keyup', event => {
            switch (event.code) {
            case 'KeyW':
                // if (!mouseDownRunning) this.moveForward = false
                break
            case 'KeyS':
                this.moveBackward = false
                break
            case 'KeyA':
            case 'ArrowLeft':
                this.moveLeft = false
                break
            case 'KeyD':
            case 'ArrowRight':
                this.moveRight = false
                break
            }
        })
        container.addEventListener('touchstart', event => {
            const touches = event.changedTouches
            const touch = touches[0]
            if (touch.clientX < window.innerWidth/2) {
                this.moveLeft = true
                this.moveRight = false
            } else {
                this.moveLeft = false
                this.moveRight = true
            }
        })
        container.addEventListener('touchend', event => {
            this.moveLeft = false
            this.moveRight = false
        })
    }

    playAnimation(name, loop = true) {
        if (this.lastAnimation === name) return

        const loopMode = loop ? THREE.LoopRepeat : THREE.LoopOnce

        const lastClip = THREE.AnimationClip.findByName(this.model, this.lastAnimation)
        const nextClip = THREE.AnimationClip.findByName(this.model, name)
        if (nextClip instanceof THREE.AnimationClip) {
            const existingAction = this.animationMixer.existingAction(lastClip)
            this.animationMixer.stopAllAction()
            const nextAction = this.animationMixer.clipAction(nextClip)
            .setLoop(loopMode)
            nextAction.clampWhenFinished = !loop
            if (existingAction) {
                nextAction.play().crossFadeFrom(existingAction, 0.2)
            } else {
                nextAction.play()
            }
        }
        this.lastAnimation = name
    }

    die() {
        this.timeOfDeath = this.world.clock.elapsedTime
        this.speed = -50
        this.playAnimation('dying', false)
    }

    move(clockDelta) {
        if (this.dead) {
            return
        }

        if (this.timeOfDeath &&
            this.world.clock.elapsedTime - this.timeOfDeath > 2.5) {
            this.dead = true
        }

        // Must be run only AFTER animations are setup
        const t = clockDelta
        const moveX = this.moveLeft || this.moveRight
        const moveZ = this.moveForward || this.moveBackward

        // Acceleration
        this.speed += t*9.81
        // Maximum velocity
        this.speed = Math.min(this.speed, 1000)

        // Calculate displacement vectors
        let trueBearingX = t * this.speed * Math.cos(this.bearing+Math.PI/2)
        let trueBearingZ = t * this.speed * Math.sin(this.bearing+Math.PI/2)
        let perpBearingX = t * this.speed * Math.cos(this.bearing)
        let perpBearingZ = t * this.speed * Math.sin(this.bearing)

        // Forward & backward - mutually exclusive
        if (this.moveForward) {
            this.model.position.x += trueBearingX
            this.model.position.z += trueBearingZ
        } else if (this.moveBackward) {
            this.model.position.x -= trueBearingX * 1/3.
            this.model.position.z -= trueBearingZ * 1/3.
        }

        // Left & right
        if (this.moveLeft) {
            this.model.position.x += perpBearingX*3/8
            this.model.position.z += perpBearingZ*3/8
            this.model.rotation.y = Math.min(Math.PI/8, this.model.rotation.y+Math.PI/2*t)
            this.model.rotation.z = Math.max(-Math.PI/16, this.model.rotation.z-Math.PI/2*t)
        } else if (this.moveRight) {
            this.model.position.x -= perpBearingX*3/8
            this.model.position.z -= perpBearingZ*3/8
            this.model.rotation.y = Math.max(-Math.PI/8, this.model.rotation.y-Math.PI/2*t)
            this.model.rotation.z = Math.min(Math.PI/16, this.model.rotation.z+Math.PI/2*t)
        } else {
            this.model.rotation.y -= this.model.rotation.y*2*t
            this.model.rotation.z -= this.model.rotation.z*2*t
        }
    }
}

const cloneFbx = (fbx) => {
    const clone = fbx.clone(true)
    clone.animations = fbx.animations
    clone.skeleton = { bones: [] }

    const skinnedMeshes = {}

    fbx.traverse(node => {
        if (node.isSkinnedMesh) {
            skinnedMeshes[node.name] = node
        }
    })

    const cloneBones = {}
    const cloneSkinnedMeshes = {}

    clone.traverse(node => {
        if (node.isBone) {
            cloneBones[node.name] = node
        }

        if (node.isSkinnedMesh) {
            cloneSkinnedMeshes[node.name] = node
        }
    })

    for (let name in skinnedMeshes) {
        const skinnedMesh = skinnedMeshes[name]
        const skeleton = skinnedMesh.skeleton
        const cloneSkinnedMesh = cloneSkinnedMeshes[name]

        const orderedCloneBones = []

        for (let i=0; i<skeleton.bones.length; i++) {
            const cloneBone = cloneBones[skeleton.bones[i].name]
            orderedCloneBones.push(cloneBone)
        }

        cloneSkinnedMesh.bind(
            new THREE.Skeleton(orderedCloneBones, skeleton.boneInverses),
            cloneSkinnedMesh.matrixWorld)

        // For animation to work correctly:
        clone.skeleton.bones.push(cloneSkinnedMesh)
        clone.skeleton.bones.push(...orderedCloneBones)
    }

    return clone
}

class Mountain {
    constructor(world, player) {
        this.world = world
        this.player = player

        this.N_VISIBLE_TREES = 50
        this.TREES_LOD = 1000
        this.STAGE_WIDTH = 750
        this.STAGE_LENGTH = 10000
        this.trees = []
        this.groundCount = 0
        this.grounds = []

        const snowMap = new THREE.TextureLoader().load('./img/snow.jpg')
        snowMap.wrapS = THREE.RepeatWrapping
        snowMap.wrapT = THREE.RepeatWrapping
        snowMap.repeat.set(this.STAGE_WIDTH/100, this.STAGE_LENGTH/100)
        this.snowMap = snowMap

        // Fog
        this.world.scene.fog = new THREE.Fog(0xeeeeee, 100, this.TREES_LOD)

        this.world.loadFbx('tree', './sources/tree.fbx', false)
        this.world.onLoaded(() => {
            // Create first ground iteration
            this.createGround()
            const tree = this.world.loadedFbx['tree']
            tree.traverse(m => {
                if (m.type === 'SkinnedMesh' ||
                    m.type === 'Mesh') {
                    m.castShadow = true
                }
            })
            tree.rotation.x = -Math.PI/16
            tree.position.y = -10
            tree.children[0].material
            this.world.onRender(t => this.render(t))
        })
    }

    createGround() {
        // Ground
        const groundGeo = new THREE.BoxGeometry(this.STAGE_WIDTH, 100, this.STAGE_LENGTH)
        const groundMat = new THREE.MeshLambertMaterial({ color: 0xe0e0e0, map: this.snowMap })
        const ground = new THREE.Mesh(groundGeo, groundMat)
        ground.receiveShadow = true
        this.world.scene.add(ground)
        ground.position.y -= 50

        // Mountains (sidewalls)
        const mountainGeo = new THREE.BoxGeometry(1000, 100, this.STAGE_LENGTH)
        const mountainMat = new THREE.MeshLambertMaterial({ color: 0x777777, map: this.snowMap })
        const leftWall = new THREE.Mesh(mountainGeo, mountainMat)
        this.world.scene.add(leftWall)
        leftWall.position.x += this.STAGE_WIDTH-100
        leftWall.position.y += 150
        leftWall.rotation.z = Math.PI/4
        const rightWall = new THREE.Mesh(mountainGeo, mountainMat)
        this.world.scene.add(rightWall)
        rightWall.position.x -= this.STAGE_WIDTH-100
        rightWall.position.y = 150
        rightWall.rotation.z = -Math.PI/4

        ground.position.z += this.groundCount*this.STAGE_LENGTH+this.STAGE_LENGTH/2
        leftWall.position.z += this.groundCount*this.STAGE_LENGTH+this.STAGE_LENGTH/2
        rightWall.position.z += this.groundCount*this.STAGE_LENGTH+this.STAGE_LENGTH/2

        this.grounds.push({ index: this.groundCount++, ground, leftWall, rightWall })
    }

    disposeGround(index) {
        // TODO: check proper disposal
        const grounds = this.grounds
        let ground = grounds.find(g => g.index === index)
        this.world.scene.remove(ground)
        grounds.splice(grounds.indexOf(ground), 1)
        ground.ground.traverse(t => {
            if (typeof t.dispose === 'function') {
                t.dispose()
            }
        })
        ground.leftWall.traverse(t => {
            if (typeof t.dispose === 'function') {
                t.dispose()
            }
        })
        ground.rightWall.traverse(t => {
            if (typeof t.dispose === 'function') {
                t.dispose()
            }
        })
        ground = null
    }

    addTree() {
        // must be called after onLoaded
        const world = this.world
        const treeBase = world.loadedFbx['tree']
        const tree = cloneFbx(treeBase)
        this.trees.push(tree)
        world.scene.add(tree)

        // Calculate random position
        const p = this.player
        const x = Math.random()*this.STAGE_WIDTH-this.STAGE_WIDTH/2
        const z = (p.position.z+this.TREES_LOD*(3/4))+(Math.random()*this.TREES_LOD*2)
        Object.assign(tree.position, { x, z })

        // Precalc intersection bounding box
        const treeGeo = new THREE.BoxGeometry(15, 200, 15)
        const treeBoundingMesh = new THREE.Mesh(treeGeo)
        Object.assign(treeBoundingMesh.position, tree.position)
        const treeBox = new THREE.Box3().setFromObject(treeBoundingMesh)
        tree.collisionBoundingBox = treeBox

        return tree
    }

    disposeTree(tree) {
        // TODO: check proper disposal
        const trees = this.trees
        this.world.scene.remove(tree)
        trees.splice(trees.indexOf(tree), 1)
        tree.traverse(t => {
            if (typeof t.dispose === 'function') {
                t.dispose()
            }
        })
        tree = null
    }

    checkCollision() {
        const trees = this.trees
        const player = this.player
        const playerBox = new THREE.Box3().setFromObject(player.model)

        if (player.position.x < -this.STAGE_WIDTH/2 ||
            player.position.x > this.STAGE_WIDTH/2) {
            player.die()
        }

        trees.forEach(tree => {
            const intersects = playerBox.intersectsBox(tree.collisionBoundingBox)
            if (intersects) {
                player.die()
            }
        })
    }

    render(t) {
        const p = this.player
        let trees = this.trees.slice()

        this.checkCollision()

        // Cull trees behind player
        trees = trees.filter(tree => {
            if (tree.position.z < p.position.z-this.TREES_LOD) {
                this.disposeTree(tree)
                return false
            } else {
                return true
            }
        })

        // Refill trees if needed
        if (trees.length < this.N_VISIBLE_TREES) {
            for (let i=trees.length; i<this.N_VISIBLE_TREES; i++) {
                const tree = this.addTree()
            }
        }

        // Refill ground
        if (Math.ceil(p.position.z/this.STAGE_LENGTH+0.5) > this.groundCount) {
            this.disposeGround(this.groundCount-1)
            this.createGround()
        }
    }
}

class RpgCamera extends THREE.PerspectiveCamera {
    constructor(world, player) {
        super(90, world.window.innerWidth/world.window.innerHeight, 0.1, 1500)
        this.player = player
        this.world = world
        // Mouse
        this.radius = 25
        this.alpha = 0
        this.beta = Math.PI*3/4
        this.offsetY = 12

        this.attachControl()
        world.onLoaded(() => {
            // Setting the camera AFTER meshes have loaded prevents glitchiness
            world.setCamera(this)
            world.onRender(t => this.update(t))
        })
    }

    update(t) {
        if (this.player.timeOfDeath && !this.player.dead) {
            this.alpha += (Math.PI-this.alpha)*5*t
        }
        if (this.player.dead) {
            this.alpha += Math.PI*t*0.1
        }

        const camPos = this.position
        const pPos = this.player.position
        // sinA=x/r, cosA=z/r
        camPos.x = pPos.x-Math.cos(this.alpha+Math.PI/2)*this.radius
        camPos.z = pPos.z-Math.sin(this.alpha+Math.PI/2)*this.radius
        // cosB=y/r
        camPos.y = pPos.y+this.offsetY-Math.cos(this.beta)*this.radius

        this.lookAt(new THREE.Vector3(0, this.offsetY, 0).add(this.player.position))
    }

    attachControl(container = this.world.renderer.domElement) {
        const wnd = this.world.window
        const doc = wnd.document
        const canvas = this.world.renderer.domElement
        wnd.addEventListener('resize', () => {
            this.aspect = wnd.innerWidth/wnd.innerHeight
            this.updateProjectionMatrix()
        })
        doc.addEventListener('mousemove', event => {
            const { buttons, movementX, movementY } = event
            if (buttons & (1<<0)) {
                // primary button (left)
                // this.alpha += movementX*0.01
                this.beta = Math.min(Math.PI,
                    Math.max(75*Math.PI/180,
                    this.beta+movementY*0.01)) // clamp [45,180]deg
            }
        })
        doc.addEventListener('mousedown', event => {
            if (!doc.pointerLockElement) canvas.requestPointerLock()
        }, false)
        doc.addEventListener('mouseup', event => {
            if (!!doc.pointerLockElement) doc.exitPointerLock()
        })
        doc.addEventListener('mousewheel', event => {
            const { deltaY } = event
            this.radius = Math.min(Math.max(10, this.radius+deltaY*0.02), 50)
        })
        doc.addEventListener('contextmenu', event => {
            event.preventDefault()
        })
    }
}

let world
let player
let mountain
let camera

document.addEventListener('DOMContentLoaded', () => {
    const scoreboard = document.querySelector('.label-score')
    const labelRekt = document.querySelector('.label-death')
    const labelRektBg = document.querySelector('.label-death-bg')
    const labelRestart = document.querySelector('.label-restart')

    function initiateGame() {
        world = new World(window)
        player = new Player(world)
        mountain = new Mountain(world, player)
        camera = new RpgCamera(world, player)

        world.onLoaded(() => {
            world.onRender(t => {
                if (!player.timeOfDeath) {
                    scoreboard.textContent = parseInt(world.clock.elapsedTime*10)
                } else {
                    labelRestart.classList.add('active')
                    scoreboard.classList.add('stopped')
                    labelRekt.classList.add('active')
                    labelRektBg.classList.add('active')
                }
            })
        })

        world.render()
    }

    initiateGame()

    window.addEventListener('keydown', event => {
        if (event.code === 'Enter' && player.timeOfDeath) {
            world.teardown()
            labelRestart.classList.remove('active')
            scoreboard.classList.remove('stopped')
            labelRekt.classList.remove('active')
            labelRektBg.classList.remove('active')
            setTimeout(() => initiateGame(), 2000)
        }
    })
})
