/** Preserve failures whose actual process state could not be established. */
export function unconfirmedError(errors, message) {
  return Object.assign(new AggregateError(errors, message), {
    code: "STATE_UNCONFIRMED",
    awaitingConfirmation: true,
  });
}
