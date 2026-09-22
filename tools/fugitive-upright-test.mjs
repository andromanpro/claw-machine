import assert from 'node:assert/strict';
import { Body, Sphere, Vec3 } from 'cannon-es';
import { Group } from 'three';
import { PrizeStand } from '../src/prize-stand.js';

const stand=Object.create(PrizeStand.prototype);
stand.floorY=-1.2;
stand.autoCollectDelay=100;
stand.randomFloorTarget=()=>({x:1,z:3});
const body=new Body({mass:1,shape:new Sphere(.25)});
body.position.set(0,-.95,3);
body.quaternion.setFromEuler(Math.PI/2,.4,0);
body.angularVelocity.set(1,.5,.5);
const toy={body,mesh:new Group(),ai:{},kind:'fugitive',r:.25,onFloor:true,onStand:false};
stand.restartFloorJourney(toy);
let up=body.quaternion.vmult(new Vec3(0,1,0));
assert.ok(up.y>.9999,`Restarted walker is still lying down: up.y=${up.y}`);
assert.equal(body.fixedRotation,true);
assert.equal(body.angularVelocity.lengthSquared(),0);
// Recover even when a continuing journey acquires an external tilted pose.
body.quaternion.setFromEuler(0,0,Math.PI/2);
stand.updateFloorFugitive(toy,1/60,null);
up=body.quaternion.vmult(new Vec3(0,1,0));
assert.ok(up.y>.9999,`Walking character is horizontal: up.y=${up.y}`);
assert.ok(Math.hypot(toy.ai.moveX,toy.ai.moveZ)>0,'Walking stopped instead of recovering the upright pose');
// A toy held by the player must keep the orientation controlled by the drag.
body.quaternion.setFromEuler(Math.PI/2,0,0);
stand.updateFloorFugitive(toy,1/60,toy);
assert.ok(Math.abs(body.quaternion.vmult(new Vec3(0,1,0)).y)<1e-6);
console.log('Released fugitives walk upright; active dragging keeps its physical rotation.');
