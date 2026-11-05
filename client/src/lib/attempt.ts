/**
 * Gọi `fn` ngay (đồng bộ, không trễ một nhịp) và luôn trả về Promise:
 * lỗi văng ngay thành Promise bị reject, giá trị không phải Promise (vd hàm giả trả undefined trong test)
 * thành Promise đã resolve. Nhờ vậy `.then/.catch` phía sau không bao giờ văng lỗi "ngoài luồng".
 */
export function attempt<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  try {
    return Promise.resolve(fn())
  } catch (err) {
    return Promise.reject(err)
  }
}
