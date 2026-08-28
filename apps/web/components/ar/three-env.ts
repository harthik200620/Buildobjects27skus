import type { Scene, WebGLRenderer } from 'three';

/**
 * The studio every three.js scene in this store is lit by, at the one roughness it uses.
 *
 * Three scenes load it — the product gallery's turntable, the live camera and the estimator's
 * house — and each had its own copy of these seven lines, including the 0.04. The house's copy
 * carried a comment saying it was "the same room environment the product gallery uses", which was
 * true and enforced by nothing: a chrome cap and a rendered elevation lit by two different guesses
 * is exactly the drift the comment was worried about.
 *
 * It is a NICETY, not a requirement, and the catch is the point: every one of these scenes still
 * reads on its analytic lights alone, so a failed dynamic import must not take the render with it.
 * The lights themselves stay with each scene, because a bulb and a building are lit differently on
 * purpose.
 */
export async function addRoomEnvironment(THREE: typeof import('three'), scene: Scene, renderer: WebGLRenderer): Promise<void> {
  try {
    const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  } catch {
    /* lights alone still read */
  }
}
