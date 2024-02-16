let W = 100;
const HIGHLIGHT = 0x70;
const HIGHLIGHT_TIME = 5;
const RADIUS = 0.25;
const DEADLINE_RADIUS = 0.34;
const HEIGHT = 4;
let PROGRESS_WIDTH = 8;
const CIRCLE_MOVE_TIME = 14;
const QUOTA_CIRCLE_RADIUS = 0.08;
let QUOTA_CIRCLE_PROGRESS_WIDTH = 12;
const TWO_PI = Math.PI * 2;
const TIMER_MUL = 2;

function Tween(func, time, reverseTime) {
  let step = 1 / (time * TIMER_MUL);
  let value = 0; // up to 1 - meaning done.
  let reverse = false;
  return {
    value,
    update: delta => {
      const nextValue = value + (reverse ? -step : step) * delta;
      value = Math.max(Math.min(nextValue, 1), 0);

      let end = reverse ? value === 0 : value === 1;
      if (value === 1 && reverseTime) {
        reverse = true;
        end = false;
        step = 1 / (reverseTime * TIMER_MUL);
      }

      return [Math.max(Math.min(func(value), 1), 0), end];
    },
  };
}

function QueueRect(x, y, height, baseColor, deadline) {
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
      highlight = Tween(x => x, HIGHLIGHT_TIME, HIGHLIGHT_TIME);
    },
    pushAnimated: (circle, onAnimationDone) => {
      circle.animateMoveTo(x, y + height - circles.length - 1, () => {
        self.startHighlight();
        if (onAnimationDone) {
          onAnimationDone();
        }
        if (deadline) {
          circle.startDeadline();
        }
      });
      circles.push(circle);
    },
    push: circle => {
      circle.updatePosition(x, y + height - circles.length - 1);
      if (deadline) {
        circle.startDeadline();
      }
      circles.push(circle);
    },
    remove: circle => {
      if (!self.empty()) {
        circles.splice(circles.indexOf(circle), 1);
      }
      updateCircles();
    },
    pop: () => {
      if (self.empty()) {
        return null;
      }

      let result;
      if (deadline) {
        let lowest = 0;
        for (let i = 1; i < circles.length; i++) {
          if (circles[i].deadline() < circles[lowest].deadline()) {
            lowest = i;
          }
        }
        result = circles.splice(lowest, 1)[0];
        result.stopDeadline();
      } else {
        result = circles.shift();
      }
      updateCircles();
      return result;
    },
    peek: () => {
      return self.empty() ? null : circles[0];
    },
    empty: () => {
      return circles.length === 0;
    }
  }

  return self;
}

function CircleProgress(radius, width, color, colorWhenFull) {
  if (!colorWhenFull) {
    colorWhenFull = color;
  }

  const edge = new PIXI.Graphics();
  const mask = new PIXI.Graphics();
  edge.mask = mask;

  let phase = 0;
  let progress = null;
  let onDone = null;

  let self = {
    init: (x, y, container) => {
      self.draw(x, y);
      container.addChild(edge);
      container.addChild(mask);
    },
    draw: (x, y) => {
      edge.clear();
      edge.lineStyle(width, phase == TWO_PI ? colorWhenFull : color, 1);
      edge.drawCircle(x * W, y * W, width + radius * W);
      edge.endFill();

      const angleStart = 0 - Math.PI / 2;
      const angle = phase + angleStart;

      mask.clear();
      mask.lineStyle(1, 0x000000, 1);
      mask.beginFill(0x000000, 1);
      mask.moveTo(x * W, y * W);
      mask.arc(x * W, y * W, width + radius * W, angleStart, angle, false);
      mask.endFill();
    },
    update: delta => {
      if (!progress) {
        return;
      }

      const [value, done] = progress.update(delta); 
      phase = TWO_PI * value;

      if (done) {
        progress = null;
        if (onDone) {
          onDone();
        }
      }
    },
    start: (runTime, forwards, onProgressDone) => {
      progress = Tween(forwards ? x => x : x => 1 - x, runTime);
      onDone = onProgressDone;
    },
    stop: () => {
      progress = null;
    },
    setPhase: newPhase => {
      phase = newPhase;
    },
    isRunning: () => {
      return !!progress;
    },
    value: () => {
      return progress ? progress.value : 1;
    },
  };

  return self;
}

const TaskState = Object.freeze({
	Idle: Symbol("idle"),
	Blocked: Symbol("blocked"),
	Running: Symbol("running"),
})

function TaskCircle(startState, color, runTime, blockTime, deadlineTime, onTaskDone, onTaskRefill) {
  const graphics = new PIXI.Graphics();
  let x = 0;
  let y = 0;

  let circleProgress = CircleProgress(RADIUS, PROGRESS_WIDTH, 0xF8F8F2);
  let state = startState;
  let moveTo = null;
  let deadlineCircleProgress = deadlineTime > 0 ? CircleProgress(DEADLINE_RADIUS, PROGRESS_WIDTH, 0xb7fc88) : null;

  let self = {
    state,
    init: (container) => {
      self.draw();
      circleProgress.init(x + RADIUS * 2, y + RADIUS * 2, container);
      if (deadlineCircleProgress) {
        deadlineCircleProgress.init(x + RADIUS * 2, y + RADIUS * 2, container);
      }
      container.addChild(graphics);
    },
    draw: () => {
      graphics.clear();
      graphics.beginFill(color, 1);
      graphics.drawCircle((x + RADIUS * 2) * W, (y + RADIUS * 2) * W, RADIUS * W);
      graphics.endFill();

      circleProgress.draw(x + RADIUS * 2, y + RADIUS * 2);
      if (deadlineCircleProgress) {
        deadlineCircleProgress.draw(x + RADIUS * 2, y + RADIUS * 2);
      }
    },
    update: delta => {
      let invalidate = false;

      if (deadlineCircleProgress && deadlineCircleProgress.isRunning()) {
        deadlineCircleProgress.update(delta);
        invalidate = true;
      }

      if (circleProgress.isRunning() && state !== TaskState.Idle) {
        circleProgress.update(delta);
        invalidate = true;
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
          circleProgress.setPhase(0);
          if (deadlineCircleProgress) {
            deadlineCircleProgress.setPhase(0);
          }
          break;
        case TaskState.Blocked:
          circleProgress.setPhase(TWO_PI);
          if (deadlineCircleProgress) {
            deadlineCircleProgress.setPhase(0);
          }
          break;
        case TaskState.Idle:
          circleProgress.setPhase(TWO_PI);
          if (deadlineCircleProgress) {
            deadlineCircleProgress.setPhase(TWO_PI);
          }
          break;
      }
    },
    setState: newState => {
      state = newState;

      if (!circleProgress.isRunning() && (state === TaskState.Running || state === TaskState.Blocked)) {
        const runState = state === TaskState.Running;
        const time = runState ? runTime : (blockTime * (Math.random() + 0.5));
        circleProgress.start(time, !runState, () => {
          callback = runState ? onTaskDone : onTaskRefill;
          callback(self);
        });
      }
    },
    animateMoveTo: (a, b, onDone) => {
      if (moveTo) {
        if (onDone) {
          moveTo.onDone = onDone;
        }

        const ratioX = (moveTo.endX - x) / (moveTo.endX - moveTo.startX);
        const ratioY = (moveTo.endY - y) / (moveTo.endY - moveTo.startY);
        moveTo.startX = ratioX ? a + (x - a) * (1 / ratioX) : a;
        moveTo.startY = ratioY ? b + (y - b) * (1 / ratioY) : b;
        moveTo.endX = a;
        moveTo.endY = b;
      } else {
        moveTo = {
          startX: x,
          endX: a,
          startY: y,
          endY: b,
          onDone,
          progress: Tween(v => v, CIRCLE_MOVE_TIME),
        };
      }
    },
    updatePosition: (a, b) => {
      x = a;
      y = b;
      self.draw();
    },
    startDeadline: () => {
      if (deadlineCircleProgress) {
        deadlineCircleProgress.start(deadlineTime, false);
      }
    },
    stopDeadline: () => {
      if (deadlineCircleProgress) {
        deadlineCircleProgress.stop();
        deadlineCircleProgress.setPhase(0);
      }
    },
    deadline: () => {
      if (!deadlineCircleProgress) {
        return 0;
      }
      if (state !== TaskState.Idle) {
        return Infinity;
      }
      return deadlineTime - deadlineTime * deadlineCircleProgress.value();
    },
  };

  self.setState(startState);
  self.resetPhase();

  return self;
}

function RunQuota(app, runTime, x, y) {
  let circleProgress = CircleProgress(QUOTA_CIRCLE_RADIUS, QUOTA_CIRCLE_PROGRESS_WIDTH, 0x50FA7B, 0xFF5555);

  let self = {
    init: container => {
      circleProgress.init(x, y, container);
    },
    update: delta => {
      circleProgress.update(delta);
      circleProgress.draw(x, y);
    },
    start: onQuotaDone => {
      if (!runTime) {
        return;
      }
      circleProgress.start(runTime, true, () => {
        self.stop();
        onQuotaDone();
      })
      app.ticker.add(self.update);
    },
    stop: () => {
      if (!runTime) {
        return;
      }
      app.ticker.remove(self.update);
    }
  };

  return self;
}

function createApp(size, element, runQuotaTime, deadline) {
  switch (size) {
    case 'small':
      W = 60;
      PROGRESS_WIDTH = 5;
      QUOTA_CIRCLE_PROGRESS_WIDTH = 7;
      break;
    case 'medium':
      W = 75;
      PROGRESS_WIDTH = 6;
      QUOTA_CIRCLE_PROGRESS_WIDTH = 8;
      break;
    case 'big':
      W = 100;
      PROGRESS_WIDTH = 8;
      QUOTA_CIRCLE_PROGRESS_WIDTH = 12;
      break;
  }

  const app = new PIXI.Application({ backgroundAlpha: 0, resizeTo: element, antialias: true });

  const centerX = size === 'big' ? 2 : 1.5;
  const leftQueue = QueueRect(0, 0, HEIGHT, 0xBD93F9, deadline);
  const centerQueue = QueueRect(centerX, (HEIGHT - 1) / 2, 1, 0x50FA7B);
  const rightQueue = QueueRect(size === 'big' ? 4 : 3, 0, HEIGHT, 0x6272A4);

  const runQuota = RunQuota(app, runQuotaTime, centerX + 0.5, (HEIGHT - 1) / 2 - 0.5);

  function onTaskDone(circle) {
    runQuota.stop();
    centerQueue.remove(circle);
    rightQueue.pushAnimated(circle, () => {
      circle.setState(TaskState.Blocked);
    });

    if (!leftQueue.empty()) {
      const runCircle = leftQueue.pop();
      centerQueue.pushAnimated(runCircle, () => {
        runCircle.setState(TaskState.Running);
        runQuota.start(onRunQuota);
      });
    }
  }

  function onTaskRefill(circle) {
    rightQueue.remove(circle);

    if (leftQueue.empty() && centerQueue.empty()) {
      centerQueue.pushAnimated(circle, () => {
        circle.setState(TaskState.Running);
        runQuota.start(onRunQuota);
      });
    } else {
      leftQueue.pushAnimated(circle, () => {
        circle.setState(TaskState.Idle);
      });
    }
  }

  function onRunQuota() {
    if (leftQueue.empty()) {
      return;
    }

    const pauseCircle = centerQueue.pop();
    const runCircle = leftQueue.pop();

    pauseCircle.setState(TaskState.Idle);
    leftQueue.pushAnimated(pauseCircle);

    centerQueue.pushAnimated(runCircle, () => {
      runCircle.setState(TaskState.Running);
      runQuota.start(onRunQuota);
    });
  }

  centerQueue.push(TaskCircle(TaskState.Running, 0xFF5555, 84, 30, deadline ? 440 : 0, onTaskDone, onTaskRefill));
  leftQueue.push(TaskCircle(TaskState.Idle, 0x8BE9FD, 77, 55, deadline ? 430 : 0, onTaskDone, onTaskRefill));
  leftQueue.push(TaskCircle(TaskState.Idle, 0xFF79C6, deadline ? 9 : 29, deadline ? 13 : 27, deadline ? 50 : 0, onTaskDone, onTaskRefill));
  leftQueue.push(TaskCircle(TaskState.Idle, 0xFFB86C, 39, 70, deadline ? 410 : 0, onTaskDone, onTaskRefill));
  leftQueue.push(TaskCircle(TaskState.Idle, 0xF1FA8C, 47, 35, deadline ? 500 : 0, onTaskDone, onTaskRefill));
  const drawables = [leftQueue, centerQueue, rightQueue, ...leftQueue.circles, ...centerQueue.circles, ...rightQueue.circles];

  const container = new PIXI.Container();
  app.stage.addChild(container);

  for (const drawable of drawables) {
    drawable.init(container);
  }
  runQuota.init(container);

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

  runQuota.start(onRunQuota);

  app.renderer.on('resize', layout);

  element.appendChild(app.view);
}

window.createApp = createApp;
