const W = 100;
const HIGHLIGHT = 0x70;
const HIGHLIGHT_TIME = 5;
const RADIUS = 0.25;
const HEIGHT = 4;
const PROGRESS_WIDTH = 8;
const CIRCLE_MOVE_TIME = 14;
const TWO_PI = Math.PI * 2;

function Tween(func, time, reverseOnEnd) {
  let step = 1 / time;
  let value = 0; // up to 1 - meaning done.
  let reverse = false;
  return {
    update: delta => {
      const nextValue = value + (reverse ? -step : step) * delta;
      value = Math.max(Math.min(nextValue, 1), 0);

      let end = reverse ? value === 0 : value === 1;
      if (value === 1 && reverseOnEnd) {
        reverse = true;
        end = false;
      }

      return [Math.max(Math.min(func(value), 1), 0), end];
    },
  };
}

function QueueRect(x, y, height, baseColor) {
  const graphics = new PIXI.Graphics();
  let color = baseColor;
  let highlight = null;
  let circles = [];

  function updateCircles() {
    let i = 0;
    for (const circle of circles) {
      circle.animateMoveTo(x, y + height - i - 1);
      i++;
    }
  }

  let self = {
    circles,
    init: (container) => {
      self.draw();
      container.addChild(graphics);
    },
    draw: () => {
      graphics.clear();
      graphics.lineStyle(4, color, 1);
      graphics.beginFill(color, 0.05);
      graphics.drawRoundedRect(x * W, y * W, W, W * height, W / 8);
      graphics.endFill();
    },
    update: delta => {
      if (!highlight) {
        return;
      }

      const [value, done] = highlight.update(delta);

      const r = Math.min(((baseColor & 0xFF0000) >> 16) + Math.round(HIGHLIGHT * value), 0xFF) << 16;
      const g = Math.min(((baseColor & 0x00FF00) >> 8) + Math.round(HIGHLIGHT * value), 0xFF) << 8;
      const b = Math.min((baseColor & 0x0000FF) + Math.round(HIGHLIGHT * value), 0xFF);

      color = r + g + b;
      self.draw();

      if (done) {
        highlight = null;
      }
    },
    startHighlight: () => {
      highlight = Tween(x => x, HIGHLIGHT_TIME, true);
    },
    pushAnimated: (circle, onAnimationDone) => {
      circle.animateMoveTo(x, y + height - circles.length - 1, () => {
        self.startHighlight();
        onAnimationDone();
      });
      circles.push(circle);
    },
    push: circle => {
      circle.updatePosition(x, y + height - circles.length - 1);
      circles.push(circle);
      self.startHighlight();
    },
    remove: circle => {
      if (!self.empty()) {
        circles.splice(circles.indexOf(circle), 1);
      }
      updateCircles();
    },
    pop: () => {
      const result = circles.length === 0 ? null : circles.shift();
      if (result) {
        updateCircles();
      }
      return result;
    },
    empty: () => {
      return circles.length === 0;
    }
  }

  return self;
}

const TaskState = Object.freeze({
	Idle: Symbol("idle"),
	Blocked: Symbol("blocked"),
	Running: Symbol("running"),
})

function TaskCircle(startState, color, runTime, onTaskDone, onTaskRefill) {
  const graphics = new PIXI.Graphics();
  let x = 0;
  let y = 0;

  const edge = new PIXI.Graphics();

  const mask = new PIXI.Graphics();
  edge.mask = mask;

  let phase = 0;
  let progress = null;
  let state = startState;
  let moveTo = null;

  let self = {
    init: (container) => {
      self.draw();
      container.addChild(graphics);
      container.addChild(edge);
      container.addChild(mask);
    },
    draw: () => {
      graphics.clear();
      graphics.beginFill(color, 1);
      graphics.drawCircle((x + RADIUS * 2) * W, (y + RADIUS * 2) * W, RADIUS * W);
      graphics.endFill();

      edge.clear();
      edge.lineStyle(PROGRESS_WIDTH, 0xF8F8F2, 1);
      edge.drawCircle((x + RADIUS * 2) * W, (y + RADIUS * 2) * W, PROGRESS_WIDTH + RADIUS * W);
      edge.endFill();

      const angleStart = 0 - Math.PI / 2;
      const angle = phase + angleStart;

      const x1 = (x + RADIUS * 2);
      const y1 = (y + RADIUS * 2);

      mask.clear();
      mask.lineStyle(1, 0x000000, 1);
      mask.beginFill(0x000000, 1);
      mask.moveTo(x1 * W, y1 * W);
      mask.arc(x1 * W, y1 * W, PROGRESS_WIDTH + RADIUS * W, angleStart, angle, false);
      mask.endFill();
    },
    update: delta => {
      let invalidate = false;

      if (progress) {
        const [value, done] = progress.update(delta); 
        phase = TWO_PI * (state === TaskState.Blocked ? value : 1 - value);
        invalidate = true;

        if (done) {
          self.resetPhase();
          callback = state === TaskState.Running ? onTaskDone : onTaskRefill;
          callback(self);
          progress = null;
        }
      }

      if (moveTo) {
        const [value, done] = moveTo.progress.update(delta);

        if (done) {
          x = moveTo.endX;
          y = moveTo.endY;

          const onDone = moveTo.onDone;
          moveTo = null;
          if (onDone) {
            onDone();
          }
        } else {
          x = moveTo.startX + (moveTo.endX - moveTo.startX) * value;
          y = moveTo.startY + (moveTo.endY - moveTo.startY) * value;
        }

        invalidate = true;
      }

      if (invalidate) {
        self.draw();
      }
    },
    resetPhase: () => {
      switch (state) {
        case TaskState.Running:
          phase = 0;
          break;
        case TaskState.Blocked:
          phase = TWO_PI;
          break;
        case TaskState.Idle:
          phase = TWO_PI;
          break;
      }
    },
    setState: newState => {
      state = newState;

      if (state === TaskState.Running || state === TaskState.Blocked) {
        progress = Tween(x => x, runTime, false);
      }
    },
    animateMoveTo: (a, b, onDone) => {
      if (moveTo) {
        if (onDone) {
          moveTo.onDone = onDone;
        }

        const ratio = (moveTo.endX - x) / (moveTo.endX - moveTo.startX);
        moveTo.startX = a + (x - a) * (1 / ratio);
        moveTo.startY = b + (y - b) * (1 / ratio);
        moveTo.endX = a;
        moveTo.endY = b;
      } else {
        moveTo = {
          startX: x,
          endX: a,
          startY: y,
          endY: b,
          onDone,
          progress: Tween(v => v, CIRCLE_MOVE_TIME, false)
        };
      }
    },
    updatePosition: (a, b) => {
      x = a;
      y = b;
      self.draw();
    },
  };

  self.setState(startState);
  self.resetPhase();

  return self;
}

function createApp(element) {
  const app = new PIXI.Application({ backgroundAlpha: 0, resizeTo: element, antialias: true });

  const leftQueue = QueueRect(0, 0, HEIGHT, 0xBD93F9);
  const centerQueue = QueueRect(2, (HEIGHT - 1) / 2, 1, 0x50FA7B);
  const rightQueue = QueueRect(4, 0, HEIGHT, 0x6272A4);

  function onTaskDone(circle) {
    centerQueue.remove(circle);
    rightQueue.pushAnimated(circle, () => {
      circle.setState(TaskState.Blocked);
    });

    if (!leftQueue.empty()) {
      const runCircle = leftQueue.pop();
      centerQueue.pushAnimated(runCircle, () => {
        runCircle.setState(TaskState.Running);
      });
    }
  }

  function onTaskRefill(circle) {
    rightQueue.remove(circle);

    if (leftQueue.empty() && centerQueue.empty()) {
      centerQueue.pushAnimated(circle, () => {
        circle.setState(TaskState.Running);
      });
    } else {
      leftQueue.pushAnimated(circle, () => {
        circle.setState(TaskState.Idle);
      });
    }
  }

  centerQueue.push(TaskCircle(TaskState.Running, 0xFF5555, 84, onTaskDone, onTaskRefill));
  leftQueue.push(TaskCircle(TaskState.Idle, 0xF1FA8C, 47, onTaskDone, onTaskRefill));
  leftQueue.push(TaskCircle(TaskState.Idle, 0x8BE9FD, 77, onTaskDone, onTaskRefill));
  leftQueue.push(TaskCircle(TaskState.Idle, 0xFF79C6, 41, onTaskDone, onTaskRefill));
  leftQueue.push(TaskCircle(TaskState.Idle, 0xFFB86C, 56, onTaskDone, onTaskRefill));
  const drawables = [leftQueue, centerQueue, rightQueue, ...leftQueue.circles, ...centerQueue.circles, ...rightQueue.circles];

  const container = new PIXI.Container();
  app.stage.addChild(container);

  for (const drawable of drawables) {
    drawable.init(container);
  }

  function layout(width, height) {
    container.x = width / 2;
    container.y = height / 2;
  }

  layout(app.screen.width, app.screen.height);

  container.pivot.x = container.width / 2;
  container.pivot.y = container.height / 2;

  app.ticker.add(delta => {
    for (const drawable of drawables) {
      drawable.update(delta);
    }
  });

  app.renderer.on('resize', layout);

  element.appendChild(app.view);
}
