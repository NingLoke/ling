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
