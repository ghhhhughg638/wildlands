import {World, CHUNK_SIZE, WATER_LEVEL, heightAt, regionAt} from './world.js';

const B = globalThis.BABYLON;
const $ = id => document.getElementById(id);
const canvas = $('game');
const mobile = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const clamp = (x,a,b) => Math.min(b, Math.max(a,x));
const L = (a,b,t) => a + (b-a)*t;
document.body.classList.toggle('touch', mobile);
const state = {x: 0, z: 0, y: heightAt(0,0), vy: 0, grounded: true, yaw: .25, pitch: -.10, firstPerson: false,
  stamina: 1, bob: 0, running: false, jumping: false, moving: false, playing: false, paused: false,
  time: 9.4, rate: 1, elapsed: 0, mapTimer: 0, hudTimer: 0, loadTimer: 0};
let engine, scene, camera, world, player, sunlight, ambient, hemispheric, clouds;
let nearest = null, toastTimer = null;
const held = new Set();
const stick = {x: 0, y: 0, pointer: null};
let lookPointer = null;
let lastPoint = null;

function showError(err) {
  console.error(err);
  $('error').hidden = false;
  $('errorMessage').textContent = (err && err.message) || String(err) || '请检查网络和浏览器 WebGL 支持。';
  $('start').classList.add('hide');
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2000);
}
function material(name, color) {
  const mat = new B.StandardMaterial(name, scene);
  mat.diffuseColor = B.Color3.FromHexString(color);
  mat.specularColor = new B.Color3(.05,.06,.06);
  return mat;
}
function createAvatar() {
  const root = new B.TransformNode('explorer', scene);
  const shirt = material('explorer-jacket','#cfbb8d');
  const pants = material('explorer-trousers','#354c46');
  const boots = material('explorer-boots','#343b36');
  const skin = material('explorer-skin','#e9c9a8');
  const hat = material('explorer-hat','#426c57');
  const pack = material('explorer-backpack','#8f7454');
  const body = B.MeshBuilder.CreateCylinder('body',{height:1.1,diameterTop:.73,diameterBottom:.62,tessellation:8}, scene);
  body.material = shirt; body.position.y = 1.43; body.parent = root;
  const head = B.MeshBuilder.CreateSphere('head',{diameter:.56,segments:8}, scene);
  head.material = skin; head.position.y = 2.26; head.parent = root;
  const cap = B.MeshBuilder.CreateCylinder('hat',{height:.19,diameterTop:.65,diameterBottom:.70,tessellation:9}, scene);
  cap.material = hat; cap.position.y = 2.58; cap.parent = root;
  const backpack = B.MeshBuilder.CreateBox('backpack',{height:.8,width:.75,depth:.37}, scene);
  backpack.material = pack; backpack.parent = root; backpack.position.set(0,1.45,-.48);
  const limbs = {};
  for (const side of [-1,1]) {
    const leg = new B.TransformNode(`leg-${side}`,scene); leg.parent=root; leg.position.set(side*.21,.91,0);
    const legMesh = B.MeshBuilder.CreateCylinder(`leg-body-${side}`,{height:.82,diameter:.29,tessellation:6},scene);
    legMesh.material=pants; legMesh.parent=leg; legMesh.position.y=-.4;
    const boot = B.MeshBuilder.CreateBox(`boot-${side}`,{width:.3,height:.24,depth:.47},scene);
    boot.material=boots; boot.parent=leg; boot.position.set(0,-.78,.08);
    const arm = new B.TransformNode(`arm-${side}`,scene); arm.parent=root; arm.position.set(side*.52,1.83,0);
    const armMesh = B.MeshBuilder.CreateCylinder(`arm-body-${side}`,{height:.82,diameter:.24,tessellation:6},scene);
    armMesh.material=shirt; armMesh.parent=arm; armMesh.position.y=-.42;
    limbs[side === -1 ? 'leftLeg' : 'rightLeg']=leg;
    limbs[side === -1 ? 'leftArm' : 'rightArm']=arm;
  }
  return {root, limbs};
}
function createClouds() {
  const cloudMat = material('cloud-color','#f0f4e6');
  cloudMat.disableLighting = true;
  const root = new B.TransformNode('clouds',scene);
  for (let n=0;n<12;n++) {
    const angle = n * 2.39996, r = 110 + (n%4)*72;
    for (let puff=0;puff<3;puff++) {
      const mesh = B.MeshBuilder.CreateSphere(`cloud-${n}-${puff}`,{diameter:1,segments:5},scene);
      mesh.material=cloudMat; mesh.parent=root;
      mesh.scaling.set(14+(puff%2)*6,3.3+(n%2)*1.2,7.5);
      mesh.position.set(Math.cos(angle)*r+puff*11,80+(n%4)*15,Math.sin(angle)*r + puff*2);
      mesh.isPickable=false;
    }
  }
  return root;
}
function setSunlight() {
  const angle = (state.time - 6) * Math.PI / 12;
  const elevation = Math.sin(angle);
  const brightness = clamp((elevation + .16) / .7, 0, 1);
  const sunset = clamp(1-Math.abs(elevation-.10)*3,0,1);
  const sky = new B.Color3(L(.055,.57,brightness),L(.11,.77,brightness),L(.19,.78,brightness));
  const amber = new B.Color3(.91,.55,.38);
  scene.clearColor = new B.Color4(L(sky.r,amber.r,sunset*.27), L(sky.g,amber.g,sunset*.27),L(sky.b,amber.b,sunset*.27),1);
  scene.fogColor = new B.Color3(scene.clearColor.r,scene.clearColor.g,scene.clearColor.b);
  sunlight.direction = new B.Vector3(-Math.cos(angle),-Math.max(.20,elevation),-.55).normalize();
  sunlight.intensity = .2 + brightness*1.35;
  sunlight.diffuse = new B.Color3(1,.96-sunset*.12,.87-sunset*.18);
  hemispheric.intensity = .28 + brightness*.80;
  const time = Math.floor(state.time)%24, mins = Math.floor((state.time%1)*60);
  $('clock').textContent = String(time).padStart(2,'0')+':'+String(mins).padStart(2,'0');
  return brightness;
}
function createWorld() {
  if (!B || !B.Engine) throw new Error('Babylon.js 无法加载，请确认网络连接并刷新页面。');
  if (!B.Engine.isSupported()) throw new Error('当前浏览器不支持 WebGL，请升级浏览器或开启硬件加速。');
  engine = new B.Engine(canvas,!mobile,{preserveDrawingBuffer:false,stencil:false,adaptToDeviceRatio:false,powerPreference:'high-performance'});
  engine.setHardwareScalingLevel(mobile ? 1.55 : 1.15);
  scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(.58,.76,.75,1);
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  scene.fogDensity = .0038;
  scene.fogColor = new B.Color3(.58,.76,.75);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.exposure = 1.15;
  scene.imageProcessingConfiguration.contrast = 1.05;
  camera = new B.FreeCamera('exploration-camera',new B.Vector3(0,10,-13),scene);
  camera.minZ = .08; camera.maxZ = 1300;
  scene.activeCamera = camera; camera.inputs.clear();
  hemispheric = new B.HemisphericLight('ambient-skylight',new B.Vector3(0,1,0),scene);
  hemispheric.groundColor = new B.Color3(.32,.30,.23);
  sunlight = new B.DirectionalLight('sun',new B.Vector3(-.5,-1,-.3),scene);
  sunlight.position = new B.Vector3(250,400,190);
  world = new World(scene,mobile);
  world.update(0,0,mobile?9:15);
  player = createAvatar();
  clouds = createClouds();
  player.root.position.set(state.x,state.y,state.z);
  setSunlight();
  const s = $('range'),q=$('quality');
  s.value = String(world.range); q.value = mobile?'1.65':'1.25';
  engine.setHardwareScalingLevel(Number(q.value));
  $('collected').textContent = String(world.totalCollected);
  $('startBtn').disabled=false;
  $('startBtn').textContent='进入世界 →';
  $('startTip').textContent=mobile?'左侧摇杆移动 · 右侧滑动观察 · 按键跳跃/采集':'WASD 移动 · 鼠标旋转视角 · F 采集';
  engine.runRenderLoop(frame);
  window.addEventListener('resize',()=>engine.resize());
  document.addEventListener('visibilitychange',()=>{if(document.hidden && state.playing && !state.paused) pause();});
}
function updateMovement(dt) {
  if (!state.playing || state.paused) return;
  let forward = (held.has('KeyW')?1:0)-(held.has('KeyS')?1:0)-stick.y;
  let sideways = (held.has('KeyD')?1:0)-(held.has('KeyA')?1:0)+stick.x;
  let moveLength = Math.hypot(forward,sideways);
  if (moveLength>1) { forward/=moveLength; sideways/=moveLength; moveLength=1; }
  state.moving = moveLength>.09;
  const sprint = (held.has('ShiftLeft')||held.has('ShiftRight')||state.running) && state.moving && state.stamina>.02;
  state.stamina = clamp(state.stamina+(sprint?-.23:.19)*dt,0,1);
  const speed = (sprint?13.2:7.4)*Math.min(1,moveLength);
  const dx = (Math.sin(state.yaw)*forward + Math.cos(state.yaw)*sideways)*speed*dt;
  const dz = (Math.cos(state.yaw)*forward - Math.sin(state.yaw)*sideways)*speed*dt;
  const nx=state.x+dx,nz=state.z+dz, here=heightAt(state.x,state.z);
  const uphill = heightAt(nx,nz)-here;
  const traversable = !world.collides(nx,nz) && (uphill<1.3 || !state.grounded);
  if (traversable) {state.x=nx;state.z=nz;}
  else {
    if (!world.collides(state.x+dx,state.z) && heightAt(state.x+dx,state.z)-here<1.3) state.x+=dx;
    if (!world.collides(state.x,state.z+dz) && heightAt(state.x,state.z+dz)-here<1.3) state.z+=dz;
  }
  const ground = heightAt(state.x,state.z);
  if (state.grounded) {
    state.y = ground;
    if (state.jumping) {state.jumping=false;state.grounded=false;state.vy=9.0;}
  } else {
    state.vy-=23*dt;
    state.y+=state.vy*dt;
    if (state.y<=ground) {state.y=ground;state.vy=0;state.grounded=true;}
  }
  if (state.moving) state.bob += dt * (sprint?13:8);
  player.root.position.set(state.x,state.y+(state.moving&&state.grounded?Math.abs(Math.sin(state.bob))*.05:0),state.z);
  player.root.rotation.y=state.yaw;
  const swing=state.moving&&state.grounded?Math.sin(state.bob)*.45:0;
  player.limbs.leftLeg.rotation.x=swing;player.limbs.rightLeg.rotation.x=-swing;
  player.limbs.leftArm.rotation.x=-swing*.7;player.limbs.rightArm.rotation.x=swing*.7;
}
function updateCamera(dt) {
  const forward = new B.Vector3(Math.sin(state.yaw)*Math.cos(state.pitch),Math.sin(state.pitch),Math.cos(state.yaw)*Math.cos(state.pitch));
  const head = new B.Vector3(state.x,state.y+2.05,state.z);
  const destination=state.firstPerson ? head : head.subtract(forward.scale(7)).add(new B.Vector3(0,2.1,0));
  if (!state.firstPerson) destination.y=Math.max(destination.y,heightAt(destination.x,destination.z)+1.05);
  const damping = Math.min(1,dt*13);
  camera.position = B.Vector3.Lerp(camera.position,destination,damping);
  if(state.firstPerson) camera.setTarget(camera.position.add(forward.scale(40)));
  else camera.setTarget(head.add(forward.scale(10)));
  player.root.setEnabled(!state.firstPerson);
}
function updateHUD() {
  $('region').textContent=regionAt(state.x,state.z);
  $('coords').textContent=`X ${Math.floor(state.x)} · Z ${Math.floor(state.z)} · 海拔 ${Math.round(state.y)}m`;
  $('chunkCount').textContent=String(world.chunks.size);
  $('collected').textContent=String(world.totalCollected);
  $('staminaFill').style.width=(state.stamina*100).toFixed(0)+'%';
  nearest=world.nearestGem(state.x,state.y,state.z);
  const hint=$('interactHint');
  hint.classList.toggle('show',Boolean(nearest));
  hint.textContent=nearest?(mobile?'点击「采集」拾取晶石':'按 F 采集附近的晶石'):'';
  $('mobileInteract').classList.toggle('selected',Boolean(nearest));
}
function drawMinimap() {
  const c=$('minimap'),ctx=c.getContext('2d',{alpha:true});
  if(!ctx) return;
  const w=c.width,h=c.height,r=180,im=ctx.createImageData(w,h);
  for(let py=0;py<h;py++) for(let px=0;px<w;px++) {
    const dx=(px-w/2)/(w/2),dz=(py-h/2)/(h/2),rr=dx*dx+dz*dz,ii=(py*w+px)*4;
    if(rr>1){im.data[ii+3]=0;continue;}
    const height=heightAt(state.x+dx*r,state.z-dz*r);
    const rgb=height<WATER_LEVEL?[72,135,160]:height<10?[91,148,91]:height<22?[111,154,101]:height<40?[111,134,108]:[155,162,150];
    const c=1-Math.pow(rr,2)*.22;
    im.data[ii]=rgb[0]*c; im.data[ii+1]=rgb[1]*c; im.data[ii+2]=rgb[2]*c; im.data[ii+3]=255;
  }
  ctx.putImageData(im,0,0);
  ctx.save();ctx.translate(w/2,h/2);ctx.rotate(state.yaw);
  ctx.beginPath();ctx.moveTo(0,11);ctx.lineTo(-7,-7);ctx.lineTo(0,-3);ctx.lineTo(7,-7);ctx.closePath();
  ctx.fillStyle='#f4ffed';ctx.strokeStyle='#173b34';ctx.lineWidth=3;ctx.stroke();ctx.fill();ctx.restore();
  ctx.beginPath();ctx.arc(w/2,h/2,w/2-2,0,Math.PI*2);ctx.strokeStyle='#f4ffeda0';ctx.lineWidth=2;ctx.stroke();
}
function frame() {
  if (!engine || !scene) return;
  const dt=Math.min(engine.getDeltaTime()/1000,.05);
  state.elapsed+=dt;
  if (state.playing && !state.paused) {
    updateMovement(dt);
    state.time=(state.time+dt*.018*state.rate)%24;
    state.loadTimer+=dt;
    state.hudTimer+=dt;state.mapTimer+=dt;
    if(state.loadTimer>.16){state.loadTimer=0;world.update(state.x,state.z,2);}
    if(state.hudTimer>.18){state.hudTimer=0;updateHUD();setSunlight();}
    if(state.mapTimer>(mobile?1.1:.55)){state.mapTimer=0;drawMinimap();}
    world.animateGems(state.elapsed);
  }
  if(world && clouds){clouds.position.x=state.x*.98;clouds.position.z=state.z*.98;clouds.rotation.y=state.elapsed*.00013;}
  updateCamera(dt);
  scene.render();
}
function enter() {
  if (!world) return;
  state.playing=true;state.paused=false;
  document.body.classList.add('playing');
  $('start').classList.add('hide');
  $('settings').classList.remove('show');
  updateHUD();drawMinimap();
  if (!mobile) canvas.requestPointerLock?.().catch(()=>toast('点击画面后可使用鼠标控制视角'));
}
function pause() {
  if(!state.playing)return;
  state.paused=true;held.clear();stick.x=stick.y=0;state.running=false;
  $('mobileRun').classList.remove('selected');
  $('settings').classList.add('show');
  if(document.pointerLockElement===canvas) document.exitPointerLock?.();
}
function resume() {
  state.paused=false;$('settings').classList.remove('show');
  if(!mobile) canvas.requestPointerLock?.().catch(()=>{});
}
function collect() {
  if(!state.playing || state.paused) return;
  const gem=world.nearestGem(state.x,state.y,state.z);
  if(gem && world.gather(gem)){toast('晶石已采集 · '+world.totalCollected);updateHUD();}
  else toast('附近没有可采集的晶石');
}
function switchView() {
  state.firstPerson=!state.firstPerson;
  toast(state.firstPerson?'第一人称视角':'第三人称视角');
}
function turn(dx,dy,scale = 1) {
  state.yaw+=dx*.0037*scale;
  state.pitch=clamp(state.pitch-dy*.0030*scale,-1.18,.87);
}
function wireControls() {
  $('startBtn').addEventListener('click',enter);
  $('settingsBtn').addEventListener('click',()=>{if(state.paused)resume();else pause();});
  $('resume').addEventListener('click',resume);
  $('view').addEventListener('click',switchView);
  $('range').addEventListener('change',e=>{world.range=clamp(Number(e.target.value),1,3);toast('加载范围已更改');});
  $('quality').addEventListener('change',e=>{engine.setHardwareScalingLevel(Number(e.target.value));engine.resize();toast('画面分辨率已更改');});
  $('timeRate').addEventListener('change',e=>{state.rate=Number(e.target.value);toast('世界时间流速已更改');});
  document.addEventListener('keydown',e=>{
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    if(e.code==='Escape'){if(state.playing&&!state.paused)pause();else if(state.paused)resume();return;}
    if(!state.playing||state.paused)return;
    held.add(e.code);
    if(e.repeat)return;
    if(e.code==='Space')state.jumping=true;
    if(e.code==='KeyF')collect();
    if(e.code==='KeyV')switchView();
  });
  document.addEventListener('keyup',e=>held.delete(e.code));
  document.addEventListener('pointerlockchange',()=>{
    if (!mobile && state.playing && !state.paused && document.pointerLockElement!==canvas) pause();
  });
  document.addEventListener('mousemove',e=>{
    if(state.playing&&!state.paused&&document.pointerLockElement===canvas)turn(e.movementX,e.movementY);
  });
  canvas.addEventListener('click',()=>{
    if(!mobile&&state.playing&&!state.paused&&document.pointerLockElement!==canvas)canvas.requestPointerLock?.().catch(()=>{});
  });
  canvas.addEventListener('pointerdown',e=>{
    if(!mobile||!state.playing||state.paused||lookPointer!==null)return;
    lookPointer=e.pointerId;lastPoint={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!mobile||!state.playing||state.paused||lookPointer!==e.pointerId||!lastPoint)return;
    turn(e.clientX-lastPoint.x,e.clientY-lastPoint.y,1.3);
    lastPoint={x:e.clientX,y:e.clientY};
  });
  const stopLook=e=>{if(e.pointerId===lookPointer){lookPointer=null;lastPoint=null;}};
  canvas.addEventListener('pointerup',stopLook);canvas.addEventListener('pointercancel',stopLook);
  const joystick=$('joystick'),knob=$('knob');
  const moveStick=e=>{
    const rect=joystick.getBoundingClientRect();
    let x=e.clientX-(rect.left+rect.width/2),y=e.clientY-(rect.top+rect.height/2);
    const length=Math.hypot(x,y),radius=rect.width*.33;
    if(length>radius){x=x/length*radius;y=y/length*radius;}
    stick.x=x/radius;stick.y=y/radius;
    knob.style.transform=`translate(calc(-50% + ${x}px),calc(-50% + ${y}px))`;
  };
  joystick.addEventListener('pointerdown',e=>{e.preventDefault();if(stick.pointer!==null)return;stick.pointer=e.pointerId;joystick.setPointerCapture(e.pointerId);moveStick(e);});
  joystick.addEventListener('pointermove',e=>{if(e.pointerId===stick.pointer)moveStick(e);});
  function releaseStick(e){if(e.pointerId!==stick.pointer)return;stick.pointer=null;stick.x=stick.y=0;knob.style.transform='translate(-50%,-50%)';}
  joystick.addEventListener('pointerup',releaseStick);joystick.addEventListener('pointercancel',releaseStick);
  $('mobileJump').addEventListener('pointerdown',e=>{e.preventDefault();if(state.playing&&!state.paused)state.jumping=true;});
  $('mobileRun').addEventListener('click',()=>{state.running=!state.running;$('mobileRun').classList.toggle('selected',state.running);});
  $('mobileInteract').addEventListener('click',collect);
  window.addEventListener('blur',()=>{held.clear();stick.x=stick.y=0;});
}
wireControls();
try{createWorld();}catch(err){showError(err);}