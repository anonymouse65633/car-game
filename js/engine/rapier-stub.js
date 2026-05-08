/**
 * rapier-stub.js
 * Placeholder so any old `import RAPIER from '@dimforge/rapier3d-compat'`
 * doesn't 404. The real physics are in physics.js.
 */
const RAPIER = globalThis.RAPIER ?? {
  init: () => Promise.resolve(),
  RigidBodyDesc: { dynamic: () => ({ setTranslation:()=>this, setRotation:()=>this, setLinearDamping:()=>this, setAngularDamping:()=>this }) },
  ColliderDesc: { cuboid: () => ({ setTranslation:()=>this, setFriction:()=>this, setRestitution:()=>this, setDensity:()=>this }) },
  QueryFilterFlags: { EXCLUDE_SENSORS: 0 },
  Vector3: class { constructor(x,y,z){this.x=x;this.y=y;this.z=z;} },
  Ray: class { constructor(o,d){this.origin=o;this.dir=d;} pointAt(t){return {x:this.origin.x+this.dir.x*t,y:this.origin.y+this.dir.y*t,z:this.origin.z+this.dir.z*t};} },
};
export default RAPIER;
