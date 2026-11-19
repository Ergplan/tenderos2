// An error a route handler turns into an HTTP status (lib/auth.js handler). Kept apart from
// auth.js, which needs the Next.js runtime, so plain modules checked in Node can throw it.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
