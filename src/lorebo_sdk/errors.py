class LoreboError(Exception):
    pass


class LockedBaseError(LoreboError):
    def __init__(self, tool_name: str, base_ref: str) -> None:
        self.tool_name = tool_name
        self.base_ref = base_ref

        super().__init__(f"{tool_name} tried to leave the locked base {base_ref}")


class LoreboToolError(LoreboError):
    def __init__(self, tool_name: str, detail: str) -> None:
        self.tool_name = tool_name
        self.detail = detail

        super().__init__(f"{tool_name} failed: {detail}")


class SkillPackageError(LoreboError):
    pass


class RunLimitError(LoreboError):
    def __init__(self, request_limit: int) -> None:
        self.request_limit = request_limit

        super().__init__(f"the run did not finish within {request_limit} model requests")
