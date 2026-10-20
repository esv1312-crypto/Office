export function shouldStopOpenRouterFallback(status) {
  // Authentication failures invalidate the shared credential. HTTP 402/429 can be
  // route/model-specific on free aggregators, so try the next candidate before
  // suppressing the entire provider.
  return Number(status) === 401;
}
