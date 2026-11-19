// shortcut: a hand-written user for the sidebar and agent creators; replace once there are accounts.
export interface User {
  name: string;
  org: string;
}

export const USER: User = { name: "Emil Eifrém", org: "Neo4j" };

// shortcut: a hand-written repo and branch for the project header; replace once projects come from git.
export interface Project {
  repo: string;
  branch: string;
}

export const PROJECT: Project = { repo: "neo4j/scip-test", branch: "trunk" };
