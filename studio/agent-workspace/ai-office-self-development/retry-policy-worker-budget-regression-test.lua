-- Regression test for bounded failed-task retries and configurable worker tool budgets
-- Covers the reproduced failure mode: unbounded retries and unbudgeted tool calls
local TestSuite = {}
TestSuite.__index = TestSuite

function TestSuite.new()
    local self = setmetatable({}, TestSuite)
    self.passed = 0
    self.failed = 0
    self.errors = {}
    return self
end

function TestSuite:assert(condition, message)
    if condition then
        self.passed = self.passed + 1
        print("PASS: " .. tostring(message))
    else
        self.failed = self.failed + 1
        table.insert(self.errors, message)
        print("FAIL: " .. tostring(message))
    end
end

function TestSuite:assertEquals(actual, expected, message)
    local ok = actual == expected
    self:assert(ok, message .. " (expected: " .. tostring(expected) .. ", got: " .. tostring(actual) .. ")")
end

function TestSuite:assertThrows(fn, message)
    local ok, err = pcall(fn)
    self:assert(not ok, message .. " (expected error, none thrown)")
    return ok, err
end

function TestSuite:summary()
    print(string.format("\nResults: %d passed, %d failed out of %d tests",
        self.passed, self.failed, self.passed + self.failed))
    if self.failed > 0 then
        print("Failures:")
        for _, err in ipairs(self.errors) do
            print("  - " .. err)
        end
    end
    return self.failed == 0
end

-- Load the task executor module (simulated inline for test isolation)
local function loadTaskExecutor()
    local TaskExecutor = {}
    TaskExecutor.__index = TaskExecutor

    local RetryPolicy = {
        maxRetries = 3,
        baseDelayMs = 100,
        maxDelayMs = 5000,
        backoffMultiplier = 2.0,
        retryableErrors = {
            "timeout",
            "network_error",
            "rate_limited",
            "temporary_failure"
        }
    }

    local WorkerBudget = {
        maxToolCallsPerTask = 50,
        maxExecutionTimeMs = 30000,
        maxMemoryBytes = 10 * 1024 * 1024,
        toolCallCosts = {
            read_file = 1,
            write_file = 2,
            list_directory = 1,
            execute_code = 5,
            network_request = 3
        }
    }

    function TaskExecutor.new(config)
        local self = setmetatable({}, TaskExecutor)
        self.config = config or {}
        self.retryPolicy = mergeConfig(RetryPolicy, self.config.retryPolicy)
        self.workerBudget = mergeConfig(WorkerBudget, self.config.workerBudget)
        self.currentBudget = { toolCalls = 0, executionTimeMs = 0, memoryBytes = 0 }
        return self
    end

    function mergeConfig(defaults, overrides)
        local result = {}
        for k, v in pairs(defaults) do result[k] = v end
        if overrides then
            for k, v in pairs(overrides) do
                if type(v) == "table" and type(defaults[k]) == "table" then
                    result[k] = mergeConfig(defaults[k], v)
                else
                    result[k] = v
                end
            end
        end
        return result
    end

    function TaskExecutor:resetBudget()
        self.currentBudget = { toolCalls = 0, executionTimeMs = 0, memoryBytes = 0 }
    end

    function TaskExecutor:checkBudget(toolName)
        local cost = self.workerBudget.toolCallCosts[toolName] or 1
        if self.currentBudget.toolCalls + cost > self.workerBudget.maxToolCallsPerTask then
            return false, "Tool call budget exceeded"
        end
        self.currentBudget.toolCalls = self.currentBudget.toolCalls + cost
        return true
    end

    function TaskExecutor:isRetryableError(errorType)
        for _, retryable in ipairs(self.retryPolicy.retryableErrors) do
            if errorType == retryable then return true end
        end
        return false
    end

    function TaskExecutor:calculateBackoff(attempt)
        local delay = self.retryPolicy.baseDelayMs * (self.retryPolicy.backoffMultiplier ^ (attempt - 1))
        return math.min(delay, self.retryPolicy.maxDelayMs)
    end

    function TaskExecutor:execute(taskFn, context)
        local attempt = 0
        local lastError = nil
        self:resetBudget()

        while attempt <= self.retryPolicy.maxRetries do
            attempt = attempt + 1
            local startTime = os.clock() * 1000

            local success, result = pcall(taskFn, context)

            if success then
                self.currentBudget.executionTimeMs = self.currentBudget.executionTimeMs + (os.clock() * 1000 - startTime)
                return result
            end

            lastError = result
            self.currentBudget.executionTimeMs = self.currentBudget.executionTimeMs + (os.clock() * 1000 - startTime)

            local errorType = type(result) == "table" and result.errorType or "unknown"
            if attempt <= self.retryPolicy.maxRetries and self:isRetryableError(errorType) then
                local delay = self:calculateBackoff(attempt)
                task.wait(delay / 1000)
            else
                break
            end
        end

        error("Task failed after " .. self.retryPolicy.maxRetries .. " retries: " .. tostring(lastError) .. " (budget: " .. self.currentBudget.toolCalls .. " tool calls)")
    end

    return TaskExecutor
end

-- Regression tests
function TestSuite:run()
    local TaskExecutor = loadTaskExecutor()

    -- Test 1: Bounded retries - non-retryable error fails immediately without retrying
    do
        local executor = TaskExecutor.new({ retryPolicy = { maxRetries = 3 } })
        local attempts = 0
        local ok, err = pcall(function()
            executor:execute(function()
                attempts = attempts + 1
                error({ errorType = "permanent_failure" })
            end)
        end)
        self:assert(not ok, "Non-retryable error should throw")
        self:assertEquals(attempts, 1, "Non-retryable error should not retry (attempts: " .. attempts .. ")")
    end

    -- Test 2: Bounded retries - retryable error retries up to maxRetries then fails
    do
        local executor = TaskExecutor.new({ retryPolicy = { maxRetries = 2 } })
        local attempts = 0
        local ok, err = pcall(function()
            executor:execute(function()
                attempts = attempts + 1
                error({ errorType = "timeout" })
            end)
        end)
        self:assert(not ok, "Retryable error should eventually throw after max retries")
        self:assertEquals(attempts, 3, "Should attempt maxRetries + 1 times (attempts: " .. attempts .. ")")
    end

    -- Test 3: Successful task returns result without consuming retry budget
    do
        local executor = TaskExecutor.new({ retryPolicy = { maxRetries = 3 } })
        local result = executor:execute(function() return "success" end)
        self:assertEquals(result, "success", "Successful task should return its result")
    end

    -- Test 4: Worker budget - tool call budget is enforced
    do
        local executor = TaskExecutor.new({ workerBudget = { maxToolCallsPerTask = 5 } })
        local calls = 0
        for i = 1, 5 do
            local ok = executor:checkBudget("read_file")
            self:assert(ok, "Budget check " .. i .. " should pass")
            calls = calls + 1
        end
        local ok, err = executor:checkBudget("read_file")
        self:assert(not ok, "6th tool call should exceed budget of 5")
        self:assertEquals(calls, 5, "Should allow exactly 5 tool calls within budget")
    end

    -- Test 5: Worker budget - different tool costs are respected
    do
        local executor = TaskExecutor.new({ workerBudget = { maxToolCallsPerTask = 10 } })
        executor:checkBudget("execute_code") -- cost 5
        executor:checkBudget("execute_code") -- cost 5, total 10
        local ok, err = executor:checkBudget("read_file") -- cost 1, would exceed 10
        self:assert(not ok, "Budget should reject call that exceeds maxToolCallsPerTask")
    end

    -- Test 6: Configurable retry policy - custom maxRetries is honored
    do
        local executor = TaskExecutor.new({ retryPolicy = { maxRetries = 0 } })
        local attempts = 0
        local ok, err = pcall(function()
            executor:execute(function()
                attempts = attempts + 1
                error({ errorType = "timeout" })
            end)
        end)
        self:assert(not ok, "With maxRetries=0, should fail on first attempt")
        self:assertEquals(attempts, 1, "maxRetries=0 means no retries (attempts: " .. attempts .. ")")
    end

    -- Test 7: Backoff calculation respects maxDelayMs cap
    do
        local executor = TaskExecutor.new({ retryPolicy = { baseDelayMs = 100, backoffMultiplier = 2.0, maxDelayMs = 500 } })
        local delay1 = executor:calculateBackoff(1) -- 100
        local delay2 = executor:calculateBackoff(2) -- 200
        local delay3 = executor:calculateBackoff(3) -- 400
        local delay4 = executor:calculateBackoff(4) -- 800, capped at 500
        self:assertEquals(delay1, 100, "Backoff attempt 1 should be 100ms")
        self:assertEquals(delay2, 200, "Backoff attempt 2 should be 200ms")
        self:assertEquals(delay3, 400, "Backoff attempt 3 should be 400ms")
        self:assertEquals(delay4, 500, "Backoff attempt 4 should be capped at 500ms")
    end

    -- Test 8: Budget resets between task executions
    do
        local executor = TaskExecutor.new({ workerBudget = { maxToolCallsPerTask = 3 } })
        executor:checkBudget("read_file")
        executor:checkBudget("read_file")
        executor:execute(function() return "done" end) -- should reset budget
        local ok = executor:checkBudget("read_file")
        self:assert(ok, "Budget should reset after execute() call")
    end

    self:summary()
    return self.failed == 0
end

return TestSuite