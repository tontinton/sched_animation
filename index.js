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
const QUOTA_PROGRESS_EXTRA_SIZE = 0.2;
const TWO_PI = Math.PI * 2;

function Tween(speed, time, reverseTime, opposite) {
  if (!opposite) {
    opposite = false;
  }
  let step = 1 / (time * speed);
  let value = 0; // up to 1 - meaning done.
  let reverse = false;
  return {
    update: delta => {
      const nextValue = value + (reverse ? -step : step) * delta;
      value = Math.max(Math.min(nextValue, 1), 0);

      let end = reverse ? value === 0 : value === 1;
      if (value === 1 && reverseTime) {
        reverse = true;
        end = false;
        step = 1 / (reverseTime * speed);
      }

      return [opposite ? 1 - value : value, end];
    },
    value: () => {
      return value;
    }
  };
}

function QueueRect(x, y, height, baseColor, speed, deadline) {
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

  function startHighlight() {
    highlight = Tween(speed, HIGHLIGHT_TIME, HIGHLIGHT_TIME);
  }

  let self = {
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

      let oldColor = color;
      color = r + g + b;
      if (color !== oldColor) {
        self.draw();
      }

      if (done) {
        highlight = null;
      }
    },
    pushAnimated: (circle, onAnimationDone) => {
      circle.animateMoveTo(x, y + height - circles.length - 1, () => {
        startHighlight();
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
      if (self.empty()) {
        return false;
      }

      circles.splice(circles.indexOf(circle), 1);
      updateCircles();
      return true;
    },
    pop: () => {
      if (self.empty()) {
        return null;
      }

      let circle;
      if (deadline) {
        let lowest = 0;
        for (let i = 1; i < circles.length; i++) {
          if (circles[i].deadline() < circles[lowest].deadline()) {
            lowest = i;
          }
        }
        circle = circles.splice(lowest, 1)[0];
        circle.stopDeadline();
      } else {
        circle = circles.shift();
      }
      updateCircles();
      return circle;
    },
    peek: () => {
      return self.empty() ? null : circles[0];
    },
    empty: () => {
      return circles.length === 0;
    },
  }

  return self;
}

function RunQuota(app, runTime, x, y, size, speed) {
  let progress = RoundedRectProgress(size, 4, 0.2, 0xF8F8F2, 0xFF5555, speed);

  function update(delta) {
    progress.update(delta);
    progress.draw(x, y);
  }

  let self = {
    init: container => {
      progress.init(x, y, container);
    },
    start: onDone => {
      progress.start(runTime, true, () => {
        self.stop();
        onDone();
      })
      app.ticker.add(update);
    },
    stop: () => {
      app.ticker.remove(update);
    },
  };

  return self;
}

function Cpu(app, idleQueue, blockedQueue, onTaskRefill, x, y, height, baseColor, runQuotaTime, speed) {
  const queue = QueueRect(x, y, height, baseColor, speed);
  let runQuota = null;
  if (runQuotaTime > 0) {
    runQuota = RunQuota(
      app,
      runQuotaTime,
      x - QUOTA_PROGRESS_EXTRA_SIZE / 2,
      y - QUOTA_PROGRESS_EXTRA_SIZE / 2,
      1 + QUOTA_PROGRESS_EXTRA_SIZE,
      speed);
  }

  function onTaskDone(circle) {
    self.remove(circle);
    blockedQueue.pushAnimated(circle, () => {
      circle.setState(TaskState.Blocked, onTaskRefill.bind(undefined, circle));
    });

    if (!idleQueue.empty()) {
      self.pushAnimated(idleQueue.pop());
    }
  }

  function onRunQuota() {
    if (idleQueue.empty()) {
      return;
    }

    const runningCircle = self.pop();
    const idleCircle = idleQueue.pop();

    runningCircle.setState(TaskState.Idle);
    idleQueue.pushAnimated(runningCircle);

    self.pushAnimated(idleCircle);
  }

  let self = {
    init: (container) => {
      queue.init(container);
      if (runQuota) {
        runQuota.init(container);
      }
    },
    draw: () => {
      queue.draw();
    },
    update: delta => {
      queue.update(delta);
    },
    pushAnimated: circle => {
      queue.pushAnimated(circle, () => {
        circle.setState(TaskState.Running, onTaskDone.bind(undefined, circle));
        if (runQuota) {
          runQuota.start(onRunQuota);
        }
      });
    },
    push: circle => {
      queue.push(circle);
      if (runQuota) {
        runQuota.start(onRunQuota);
      }
    },
    remove: circle => {
      const removed = queue.remove(circle);
      if (removed && runQuota) {
        runQuota.stop();
      }
      return removed;
    },
    pop: () => {
      const circle = queue.pop();
      if (circle && runQuota) {
        runQuota.stop();
      }
      return circle;
    },
    peek: () => {
      return queue.peek();
    },
    empty: () => {
      return queue.empty();
    },
    run: () => {
      let circle = self.peek();
      if (circle) {
        circle.setState(TaskState.Running, onTaskDone.bind(undefined, circle));
        if (runQuota) {
          runQuota.start(onRunQuota);
        }
      } else {
        circle = idleQueue.pop();
        if (circle) {
          self.pushAnimated(circle);
        }
      }
    },
  };

  return self;
}

function CircleProgress(radius, lineWidth, color, speed) {
  const edge = new PIXI.Graphics();
  const mask = new PIXI.Graphics();
  edge.mask = mask;

  let phase = 0;
  let previousPhase = null;
  let progress = null;
  let onDone = null;

  let self = {
    init: (x, y, container) => {
      edge.lineStyle(lineWidth, color, 1);
      edge.drawCircle(x * W, y * W, lineWidth + radius * W);
      edge.endFill();
      self.draw(x, y);
      container.addChild(edge);
      container.addChild(mask);
    },
    draw: (x, y) => {
      edge.position.x = x * W;
      edge.position.y = y * W;
      mask.position.x = x * W;
      mask.position.y = y * W;

      if (previousPhase !== phase) {
        const angleStart = 0 - Math.PI / 2;
        const angle = phase + angleStart;

        mask.clear();
        mask.lineStyle(1, 0x000000, 1);
        mask.beginFill(0x000000, 1);
        mask.moveTo(RADIUS * W, RADIUS * W);
        mask.arc(RADIUS * W, RADIUS * W, lineWidth + radius * W, angleStart, angle, false);
        mask.endFill();
      }

      previousPhase = phase;
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
      progress = Tween(speed, runTime, null, !forwards);
      onDone = onProgressDone;
    },
    setOnDone: onProgressDone => {
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
      return self.isRunning() ? progress.value() : 1;
    },
  };

  return self;
}

function RoundedRectProgress(size, lineWidth, radius, color, colorWhenFull, speed) {
  if (!colorWhenFull) {
    colorWhenFull = color;
  }

  const edge = new PIXI.Graphics();
  const mask = new PIXI.Graphics();
  edge.mask = mask;

  let phase = 0;
  let previousPhase = null;
  let progress = null;
  let onDone = null;

  let self = {
    init: (x, y, container) => {
      edge.lineStyle(lineWidth, phase == TWO_PI ? colorWhenFull : color, 1);
      edge.drawRoundedRect(x * W, y * W, size * W, size * W, radius * W);
      edge.endFill();
      self.draw(x, y);
      container.addChild(edge);
      container.addChild(mask);
    },
    draw: (x, y) => {
      mask.position.x = x * W;
      mask.position.y = y * W;

      if (previousPhase !== phase) {
        const angleStart = 0 - Math.PI / 2;
        const angle = phase + angleStart;

        mask.clear();
        mask.lineStyle(1, 0x000000, 1);
        mask.beginFill(0x000000, 1);
        mask.moveTo((size / 2) * W, (size / 2) * W);
        mask.arc((size / 2) * W, (size / 2) * W, lineWidth + (size / 1.5) * W, angleStart, angle, false);
        mask.endFill();
      }

      previousPhase = phase;
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
      progress = Tween(speed, runTime, null, !forwards);
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

function TaskCircle(startState, color, runTime, blockTime, deadlineTime, speed) {
  const graphics = new PIXI.Graphics();
  graphics.cacheAsBitmap = true;
  graphics.epsilon = 100;
  let x = 0;
  let y = 0;

  let circleProgress = CircleProgress(RADIUS, PROGRESS_WIDTH, 0xF8F8F2, speed);
  let state = startState;
  let moveTo = null;
  let deadlineCircleProgress = deadlineTime > 0 ? CircleProgress(DEADLINE_RADIUS, PROGRESS_WIDTH, 0xb7fc88, speed) : null;

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

  let self = {
    init: (container) => {
      graphics.beginFill(color, 1);
      graphics.drawCircle((x + RADIUS) * W, (y + RADIUS) * W, RADIUS * W);
      graphics.endFill();
      circleProgress.init(x + RADIUS, y + RADIUS, container);
      if (deadlineCircleProgress) {
        deadlineCircleProgress.init(x + RADIUS, y + RADIUS, container);
      }
      container.addChild(graphics);
    },
    draw: () => {
      graphics.position.x = (x + RADIUS) * W;
      graphics.position.y = (y + RADIUS) * W;

      circleProgress.draw(x + RADIUS, y + RADIUS);
      if (deadlineCircleProgress) {
        deadlineCircleProgress.draw(x + RADIUS, y + RADIUS);
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

        x = moveTo.startX + (moveTo.endX - moveTo.startX) * value;
        y = moveTo.startY + (moveTo.endY - moveTo.startY) * value;

        if (done) {
          const onDone = moveTo.onDone;
          moveTo = null;
          if (onDone) {
            onDone();
          }
        }

        invalidate = true;
      }

      if (invalidate) {
        self.draw();
      }
    },
    setState: (newState, onStateDone) => {
      state = newState;

      if (circleProgress.isRunning()) {
        circleProgress.setOnDone(onStateDone);
      } else if (state === TaskState.Running || state === TaskState.Blocked) {
        const runState = state === TaskState.Running;
        const time = runState ? runTime : (blockTime * (Math.random() + 0.5));
        circleProgress.start(time, !runState, onStateDone);
      }
    },
    animateMoveTo: (a, b, onDone) => {
      if (moveTo) {
        if (onDone) {
          moveTo.onDone = onDone;
        }

        if (a == moveTo.endX && b == moveTo.endY) {
          return;
        }

        moveTo.startX = x;
        moveTo.startY = y;
        moveTo.endX = a;
        moveTo.endY = b;
        moveTo.progress = Tween(speed, CIRCLE_MOVE_TIME);
      } else {
        moveTo = {
          startX: x,
          endX: a,
          startY: y,
          endY: b,
          onDone,
          progress: Tween(speed, CIRCLE_MOVE_TIME),
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

  return self;
}

function createApp(size, element, speed, runQuotaTime, deadline, numCpus) {
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

  if (!numCpus) {
    numCpus = 1;
  }

  const app = new PIXI.Application({ backgroundAlpha: 0, resizeTo: element, antialias: true });
  app.renderer.view.style.touchAction = 'auto';

  const idleQueue = QueueRect(size === 'big' ? -2.5 : -2, -2, HEIGHT, 0xBD93F9, speed, deadline);
  const blockedQueue = QueueRect(size === 'big' ? 1.5 : 1, -2, HEIGHT, 0x6272A4, speed);

  const cpus = []

  function onTaskRefill(circle) {
    if (!blockedQueue.remove(circle)) {
      return;
    }

    if (idleQueue.empty()) {
      for (const cpu of cpus) {
        if (cpu.empty()) {
          cpu.pushAnimated(circle);
          return;
        }
      }
    }

    circle.setState(TaskState.Idle);
    idleQueue.pushAnimated(circle);
  }

  for (let i = 0; i < numCpus; i++) {
    const offset = i * HEIGHT / numCpus;
    const step = HEIGHT / numCpus;
    const y = offset + step / 2;
    const cpu = Cpu(app, idleQueue, blockedQueue, onTaskRefill, -0.5, y - 2.5, 1, 0x50FA7B, runQuotaTime, speed);
    cpus.push(cpu);
  }

  const circles = [
    TaskCircle(TaskState.Running, 0xFF5555, 84, 30, deadline ? 440 : 0, speed),
    TaskCircle(TaskState.Idle, 0x8BE9FD, 77, 55, deadline ? 430 : 0, speed),
    TaskCircle(TaskState.Idle, 0xFF79C6, deadline ? 9 : 29, deadline ? 13 : 27, deadline ? 50 : 0, speed),
    TaskCircle(TaskState.Idle, 0xFFB86C, 39, 70, deadline ? 410 : 0, speed),
    TaskCircle(TaskState.Idle, 0xF1FA8C, 47, 35, deadline ? 500 : 0, speed),
  ];

  const container = new PIXI.Container();
  app.stage.addChild(container);

  function layout(width, height) {
    container.x = width / 2;
    container.y = height / 2;
  }

  layout(app.screen.width, app.screen.height);

  container.pivot.x = container.width / 2;
  container.pivot.y = container.height / 2;

  const drawables = [idleQueue, ...cpus, blockedQueue, ...circles];

  for (const drawable of drawables) {
    drawable.init(container);
  }

  cpus[0].push(circles[0]);
  for (let i = 1; i < circles.length; i++) {
    idleQueue.push(circles[i]);
  }

  app.ticker.add(delta => {
    for (const drawable of drawables) {
      drawable.update(delta);
    }
  });

  for (const cpu of cpus) {
    cpu.run();
  }

  app.renderer.on('resize', layout);

  element.appendChild(app.view);

  let f = () => {
    let bottomOfScreen = window.scrollY + window.innerHeight + 50;
    let topOfScreen = window.scrollY - 50;
    let bottomOfElement = element.offsetTop + element.offsetHeight;
    let topOfElement = element.offsetTop;

    let isVisible = bottomOfScreen > topOfElement &&
        topOfScreen < bottomOfElement;

    if (!app.ticker.started && isVisible) {
        app.ticker.start();
        app.start();
        return;
    }

    if (app.ticker.started && !isVisible) {
        app.ticker.stop();
        app.stop();
        return;
    }
  }

  window.addEventListener("scroll", f);
  window.addEventListener("focus", f);
  window.addEventListener("blur", f);
  f();

  return {
    stop: () => {
      window.removeEventListener("scroll", f);
      window.removeEventListener("focus", f);
      window.removeEventListener("blur", f);
      app.stop();
      app.destroy(true);
    },
  };
}

window.createApp = createApp;
