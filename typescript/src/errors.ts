export class LoreboError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LoreboError";
  }
}

export class LockedBaseError extends LoreboError {
  readonly toolName: string;
  readonly baseRef: string;

  constructor(toolName: string, baseRef: string) {
    super(`${toolName} tried to leave the locked base ${baseRef}`);
    this.name = "LockedBaseError";
    this.toolName = toolName;
    this.baseRef = baseRef;
  }
}

export class LoreboToolError extends LoreboError {
  readonly toolName: string;
  readonly detail: string;

  constructor(toolName: string, detail: string, options?: ErrorOptions) {
    super(`${toolName} failed: ${detail}`, options);
    this.name = "LoreboToolError";
    this.toolName = toolName;
    this.detail = detail;
  }
}

export class SkillPackageError extends LoreboError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SkillPackageError";
  }
}

export class RunLimitError extends LoreboError {
  readonly stepLimit: number;

  constructor(stepLimit: number, options?: ErrorOptions) {
    super(`the run did not finish within ${stepLimit} model steps`, options);
    this.name = "RunLimitError";
    this.stepLimit = stepLimit;
  }
}
