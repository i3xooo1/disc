export class DiscordCooldownError extends Error {
  constructor(public retryAfter: number) {
    super('Discord is temporarily limiting member requests. Wait for the countdown, then try again.');
  }
}
