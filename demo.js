// Example courses used only when no Canvas token is configured.
const DAY = 864e5;
const at = (offset, h = 23, m = 59) => {
  const d = new Date(Date.now() + offset * DAY);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

let nextId = 1000;
function a(name, due, points, group, score, o = {}) {
  const submitted = score != null || o.submitted;
  return {
    id: nextId++,
    name,
    due_at: at(due),
    lock_at: o.lock != null ? at(o.lock) : null,
    points_possible: points,
    assignment_group_id: group,
    submission_types: o.types || ["online_upload"],
    html_url: "#",
    published: true,
    locked_for_user: false,
    submission: {
      score,
      workflow_state: score != null ? "graded" : submitted ? "submitted" : "unsubmitted",
      submitted_at: submitted ? at(due - 1, 20) : null,
      missing: !!o.missing,
      late: !!o.late,
      excused: false,
    },
  };
}

export function demoCourses() {
  nextId = 1000;
  return [
    {
      id: 1, name: "Cell Biology", code: "BIO 201", url: "#", weighted: true, score: null, grade: null,
      groups: [{ id: 11, name: "Exams", weight: 50 }, { id: 12, name: "Labs", weight: 30 }, { id: 13, name: "Homework", weight: 20 }],
      assignments: [
        a("Exam 1: Membranes & Transport", -18, 100, 11, 74),
        a("Lab 1: Microscopy", -24, 20, 12, 18),
        a("Lab 2: Osmosis in Potato Cores", -14, 20, 12, 15),
        a("Lab 3: Enzyme Kinetics", -3, 20, 12, null, { missing: true, lock: 4 }),
        a("Homework 1", -21, 10, 13, 10, { types: ["online_text_entry"] }),
        a("Homework 2", -10, 10, 13, 7, { types: ["online_text_entry"] }),
        a("Homework 3: Cell Cycle", 2, 10, 13, null, { types: ["online_text_entry", "online_upload"] }),
        a("Lab 4: Mitosis in Onion Root Tips", 5, 20, 12, null),
        a("Homework 4: Signaling", 9, 10, 13, null, { types: ["online_text_entry"] }),
        a("Exam 2: Cell Cycle & Signaling", 16, 100, 11, null, { types: ["on_paper"] }),
      ],
    },
    {
      id: 2, name: "Calculus II", code: "MATH 152", url: "#", weighted: false, score: null, grade: null,
      groups: [{ id: 21, name: "Assignments", weight: 0 }],
      assignments: [
        a("Quiz 1: Integration by Parts", -26, 20, 21, 16, { types: ["on_paper"] }),
        a("Problem Set 1", -22, 50, 21, 46),
        a("Quiz 2: Trig Substitution", -15, 20, 21, 12, { types: ["on_paper"] }),
        a("Problem Set 2", -12, 50, 21, 41),
        a("Midterm", -6, 150, 21, 118, { types: ["on_paper"] }),
        a("Problem Set 3: Series", 1, 50, 21, null),
        a("Quiz 3: Convergence Tests", 6, 20, 21, null, { types: ["on_paper"] }),
        a("Problem Set 4: Power Series", 8, 50, 21, null),
        a("Final Exam", 48, 200, 21, null, { types: ["on_paper"] }),
      ],
    },
    {
      id: 3, name: "College Writing", code: "ENGL 110", url: "#", weighted: true, score: null, grade: null,
      groups: [{ id: 31, name: "Essays", weight: 60 }, { id: 32, name: "Reading Responses", weight: 25 }, { id: 33, name: "Participation", weight: 15 }],
      assignments: [
        a("Essay 1: Literacy Narrative", -20, 100, 31, 88, { types: ["online_upload", "online_url"] }),
        a("Reading Response 1", -25, 10, 32, 10, { types: ["online_text_entry"] }),
        a("Reading Response 2", -18, 10, 32, 9, { types: ["online_text_entry"] }),
        a("Reading Response 3", -6, 10, 32, null, { types: ["online_text_entry"], missing: true }),
        a("Reading Response 4", -2, 10, 32, 8, { types: ["online_text_entry"] }),
        a("Participation: Weeks 1–6", -4, 15, 33, 15, { types: ["none"] }),
        a("Reading Response 5", 1, 10, 32, null, { types: ["online_text_entry"] }),
        a("Essay 2 Draft: Rhetorical Analysis", 3, 50, 31, null, { types: ["online_upload", "online_url"] }),
        a("Essay 2 Final", 13, 100, 31, null, { types: ["online_upload", "online_url"] }),
      ],
    },
    {
      id: 4, name: "World History to 1500", code: "HIST 105", url: "#", weighted: false, score: null, grade: null,
      groups: [{ id: 41, name: "Assignments", weight: 0 }],
      assignments: [
        a("Map Quiz", -23, 25, 41, 23, { types: ["on_paper"] }),
        a("Paper 1: Primary Source Analysis", -12, 100, 41, 92),
        a("Quiz 2: Classical Empires", -5, 25, 41, 20, { types: ["online_quiz"] }),
        a("Discussion: Trade Networks", -2, 10, 41, null, { types: ["discussion_topic"], missing: true }),
        a("Reading Quiz: Silk Roads", 4, 15, 41, null, { types: ["online_quiz"] }),
        a("Paper 2: Comparative Essay", 11, 100, 41, null, { types: ["online_upload"] }),
        a("Final Project", 30, 150, 41, null, { types: ["online_upload", "online_url"] }),
      ],
    },
  ];
}
