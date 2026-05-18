function isShailaPriority(priorityId, priorities = []) {
  return priorityId === "shaila" || priorities.some(p => p?.id === priorityId && p?.isShaila && !p?.deleted);
}

function isNerveTaskShailaWork(task, priorities = []) {
  return task?._nerveKind === "shaila" ||
    task?.type === "shailo-research" ||
    task?.type === "shaila-research" ||
    !!task?.shailaId ||
    !!task?.isGetBackStep ||
    isShailaPriority(task?.priority, priorities);
}

function shailaCreatedAt(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return Number(value) || 0;
}

function shailaField(item, field) {
  if (!item) return undefined;
  const fields = item.fields || item.Fields;
  if (fields && Object.prototype.hasOwnProperty.call(fields, field)) return fields[field];
  return item[field];
}

function shailaStatus(item) {
  return String(shailaField(item, "status") || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function shailaFlag(item, field) {
  const value = shailaField(item, field);
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function shailaText(item) {
  return String(
    shailaField(item, "parentTask") ||
    shailaField(item, "synopsis") ||
    shailaField(item, "parsedShaila") ||
    shailaField(item, "content") ||
    shailaField(item, "shailaQuestion") ||
    shailaField(item, "text") ||
    ""
  ).trim();
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function shailaHasAnswer(item) {
  return hasText(shailaField(item, "answer")) ||
    hasText(shailaField(item, "shailaAnswer")) ||
    hasText(shailaField(item, "answerSummary")) ||
    hasText(shailaField(item, "answeredBy")) ||
    hasText(shailaField(item, "answererName"));
}

function shailaIsGotBack(item) {
  return shailaStatus(item) === "got_back" ||
    shailaFlag(item, "gotBackToAsker") ||
    shailaFlag(item, "gotBack") ||
    shailaFlag(item, "got_back");
}

function shailaIsAnswered(item) {
  const status = shailaStatus(item);
  return status === "answered" || status === "have_answer" || shailaHasAnswer(item);
}

function shailaGroupKey(task) {
  if (task?.shailaId) return `id:${task.shailaId}`;
  const parent = String(task?.parentTask || "").trim().toLowerCase();
  if (parent) return `parent:${parent}`;
  return `task:${task?.id || shailaText(task).toLowerCase()}`;
}

function buildNerveShailaRows(tasks = [], priorities = [], sourceShailos = []) {
  const groups = new Map();

  (tasks || []).forEach((task, index) => {
    if (!isNerveTaskShailaWork(task, priorities)) return;
    const key = shailaGroupKey(task);
    const existing = groups.get(key) || {
      id: key,
      shailaId: task.shailaId || null,
      parentTask: task.parentTask || task.text || "",
      tasks: [],
      order: index,
      createdAt: task.createdAt || 0,
    };
    existing.tasks.push(task);
    existing.order = Math.min(existing.order, index);
    existing.createdAt = Math.min(existing.createdAt || task.createdAt || 0, task.createdAt || existing.createdAt || 0);
    existing.shailaId = existing.shailaId || task.shailaId || null;
    existing.parentTask = shailaText(existing) || shailaText(task);
    groups.set(key, existing);
  });

  (sourceShailos || []).forEach((shaila, index) => {
    if (!shaila?.id) return;
    const key = `id:${shaila.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sourceShaila = shaila;
      existing.parentTask = shailaText(existing) || shailaText(shaila);
      existing.createdAt = existing.createdAt || shailaCreatedAt(shaila.createdAt || shaila.updatedAt);
      groups.set(key, existing);
      return;
    }
    if (shailaIsGotBack(shaila)) return;
    groups.set(key, {
      id: key,
      shailaId: shaila.id,
      parentTask: shailaText(shaila),
      tasks: [],
      order: tasks.length + index,
      createdAt: shailaCreatedAt(shaila.createdAt || shaila.updatedAt),
      sourceShaila: shaila,
    });
  });

  return [...groups.values()]
    .map(group => {
      const activeTasks = group.tasks.filter(t => !t.completed);
      const researchTasks = group.tasks.filter(t => !t.isGetBackStep);
      const getBackTasks = group.tasks.filter(t => t.isGetBackStep);
      const activeResearch = researchTasks.find(t => !t.completed);
      const activeGetBack = getBackTasks.find(t => !t.completed);
      const sourceAnswered = shailaIsAnswered(group.sourceShaila);
      const answered = sourceAnswered ||
        researchTasks.some(t => t.completed || shailaHasAnswer(t));
      const gotBack = shailaIsGotBack(group.sourceShaila) || getBackTasks.some(t => t.completed || shailaIsGotBack(t));
      const status = gotBack ? "got_back" : sourceAnswered || (activeGetBack && (answered || !activeResearch)) ? "get_back" : "research";
      const displayTask = status === "get_back" ? (activeGetBack || group.sourceShaila || activeResearch) : activeResearch || activeTasks[0] || group.tasks[0] || group.sourceShaila;
      if (gotBack || !displayTask) return null;
      return {
        ...displayTask,
        id: group.shailaId ? `shaila:${group.shailaId}` : group.id,
        shailaId: group.shailaId,
        parentTask: group.parentTask || shailaText(displayTask),
        text: group.parentTask || displayTask.text,
        status,
        isGetBackStep: status === "get_back",
        _nerveKind: "shaila",
        _nerveOrder: group.order,
        _nerveCreatedAt: group.createdAt || displayTask.createdAt || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a._nerveOrder - b._nerveOrder) || ((a._nerveCreatedAt || 0) - (b._nerveCreatedAt || 0)));
}

export { buildNerveShailaRows, isNerveTaskShailaWork, isShailaPriority, shailaIsAnswered, shailaIsGotBack };
