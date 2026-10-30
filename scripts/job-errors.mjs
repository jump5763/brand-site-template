/** Preserve both failures without releasing a task whose effects are uncertain. */
export function unconfirmedError(errors, message) {
  return Object.assign(new AggregateError(errors, message), {
    code: "STATE_UNCONFIRMED",
    awaitingConfirmation: true,
  });
}
