export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startApplicationWarmup } = await import("./lib/server/application-warmup");
  startApplicationWarmup();
  const { startPushDispatcher } = await import("./lib/server/push-dispatcher");
  startPushDispatcher();
}
