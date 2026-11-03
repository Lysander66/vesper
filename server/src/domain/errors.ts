/** 业务异常，HTTP 层按类名转成 404 / 409。 */

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} 不存在`)
    this.name = 'NotFound'
  }
}

/** 当前状态不允许这个操作。 */
export class Conflict extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Conflict'
  }
}
