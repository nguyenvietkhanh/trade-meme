class ReadOnlyExecutor:
    def submit(self, *args, **kwargs):
        raise RuntimeError("STAGE_1_READ_ONLY: execution is not implemented")
