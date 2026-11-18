import { InputError, compose, identity, inverse, parseTransform } from './math.js';

export const DIRECTIONS = {
  'robot-camera': { source: 'Robot', target: 'Camera', formula: 'p_camera = R · p_robot + t' },
  'camera-robot': { source: 'Camera', target: 'Robot', formula: 'p_robot = R · p_camera + t' },
};
export const oppositeDirection = (direction) => direction === 'robot-camera' ? 'camera-robot' : 'robot-camera';
const POSE_DIRECTIONS = { robot: 'camera-robot', camera: 'robot-camera' };

export class TransformModel {
  #results;
  #referenceFrame = 'robot';

  constructor() {
    this.outputDirection = 'camera-robot';
    this.draft = '';
    this.precision = 9;
    this.clearResult();
  }

  setDraft(text) {
    this.draft = text;
    this.draftError = null;
  }

  applyFormat(formatId) {
    try {
      const { transform: increment, notices } = parseTransform(this.draft, formatId);
      this.#commit(compose(increment, this.result ?? identity()), notices);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      this.draftError = error;
    }
  }

  #commit(transform, notices) {
    this.#results = {
      [this.outputDirection]: transform,
      [oppositeDirection(this.outputDirection)]: inverse(transform),
    };
    this.#updateScene();
    this.notices = notices;
    this.draftError = null;
  }

  #updateScene() {
    const poseDirection = POSE_DIRECTIONS[this.#referenceFrame];
    const { source, target } = DIRECTIONS[poseDirection];
    this.scene = this.#results ? { source: target, target: source, pose: this.#results[poseDirection] } : null;
  }

  get referenceFrame() {
    return this.#referenceFrame;
  }

  selectReferenceFrame(frame) {
    if (frame === this.#referenceFrame || !Object.prototype.hasOwnProperty.call(POSE_DIRECTIONS, frame)) return;
    this.#referenceFrame = frame;
    this.#updateScene();
  }

  selectOutputDirection(direction) {
    if (Object.prototype.hasOwnProperty.call(DIRECTIONS, direction)) this.outputDirection = direction;
  }

  invertOutput() {
    if (this.#results) this.outputDirection = oppositeDirection(this.outputDirection);
  }

  resetIdentity() {
    this.#commit(identity(), []);
  }

  clearResult() {
    this.#results = null;
    this.scene = null;
    this.notices = [];
    this.draftError = null;
  }

  get result() {
    return this.#results?.[this.outputDirection] ?? null;
  }
}
