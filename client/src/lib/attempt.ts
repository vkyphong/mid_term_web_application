/** Gọi fn ngay và luôn trả Promise (lỗi văng ngay → reject). */
export function attempt<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  try {
    return Promise.resolve(fn())
  } catch (err) {
    return Promise.reject(err)
  }
}
