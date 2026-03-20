const fs = require('fs');

const raw = fs.readFileSync(process.argv[2], 'utf8');
const data = JSON.parse(raw);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Old formats had priorities like pink, blue, orange. Map to v4 priorities
const priMap = {
  'pink': 'now',
  'orange': 'today',
  'blue': 'eventually'
};

const tasks = [];
if (data.incomplete) {
  data.incomplete.forEach(t => {
    tasks.push({
      id: uid(),
      text: t.title,
      completed: false,
      priority: priMap[t.priority] || 'eventually',
      createdAt: new Date(t.created_date).getTime()
    });
  });
}

if (data.completed) {
  data.completed.forEach(t => {
    tasks.push({
      id: uid(),
      text: t.title,
      completed: true,
      completedAt: new Date(t.completed_at).getTime(),
      priority: priMap[t.priority] || 'eventually',
      createdAt: new Date(t.created_date).getTime()
    });
  });
}

const v4State = {
  lists: [
    {
      id: "default",
      name: "My Tasks",
      tasks: tasks
    }
  ],
  activeListId: "default",
  priorities: [
    {id:"now",        label:"Now",        color:"#E09AB8", weight:3},
    {id:"today",      label:"Today",      color:"#E0B472", weight:2},
    {id:"eventually", label:"Eventually", color:"#7EB0DE", weight:1},
  ],
  colorScheme: "claude",
  zenEnabled: false,
  _lsModified: Date.now()
};

fs.writeFileSync('v4_restore_state.json', JSON.stringify(v4State));
console.log("Written to v4_restore_state.json. Copy this into localStorage.setItem('onetaskonly_v4_rabbidanziger', '<json>')");
