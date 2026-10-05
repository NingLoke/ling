// Which classes to track, and which SWS group each unit uses for that class.
// groups: group ids as SWS writes them ("3E4", "K", "*" = any group).
// staff:  optional teacher-name filter (substring, case-insensitive).
export const CLASSES = {
  "2E3": {
    title: "2E3",
    selections: [
      { unit: "CMFP0042", groups: ["K"], short: "Maths 2" },
      { unit: "CMFP0051", groups: ["2E3"], short: "Physics 2" },
      { unit: "CMFP0061", groups: ["2E3"], short: "Programming" },
      { unit: "FP-070", groups: ["*"], staff: "Grace", short: "Academic English" },
      { unit: "CMFP0021", groups: ["2E3"], short: "ECS" },
    ],
  },
  "2E4": {
    title: "2E4",
    // Maths and English: the same classes as 2E3
    selections: [
      { unit: "CMFP0042", groups: ["K"], short: "Maths 2" },
      { unit: "CMFP0051", groups: ["2E4"], short: "Physics 2" },
      { unit: "CMFP0061", groups: ["2E4"], short: "Programming" },
      { unit: "FP-070", groups: ["*"], staff: "Grace", short: "Academic English" },
      { unit: "CMFP0021", groups: ["2E4"], short: "ECS" },
    ],
  },
  "3E2": {
    title: "3E2",
    // The foundation units with classes for 3E2 in SWS. Not Programming: its only 3E2 class is a lab shared with
    // 3E1/3E4 that clashes with 3E2's Critical Thinking seminar, and the lecture is not for 3E2. Not Management:
    // only its lecture for "All", no 3E2 tutorial.
    selections: [
      { unit: "CMFP0043", groups: ["3E2"], short: "Maths 3" },
      { unit: "CMFP0051", groups: ["3E2"], short: "Physics 2" },
      { unit: "CMFP0023", groups: ["3E2"], short: "Critical Thinking" },
    ],
  },
  "3E4": {
    title: "3E4",
    selections: [
      { unit: "CMFP0043", groups: ["3E4"], short: "Maths 3" },
      { unit: "CMFP0061", groups: ["3E4"], short: "Programming" },
      { unit: "CMFP0023", groups: ["3E4"], short: "Critical Thinking" },
      { unit: "CMFP0032", groups: ["3E4"], short: "Management" },
    ],
  },
};

export const ALL_UNITS = [...new Set(Object.values(CLASSES).flatMap((c) => c.selections.map((s) => s.unit)))];
