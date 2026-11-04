/**
 * Tên người Việt ngẫu nhiên cho tài khoản test, để danh sách "Đồng nghiệp" trông như người thật thay vì
 * "E2E alice 1a2b3c". Họ + hai tên đệm + tên ≈ 180 nghìn tổ hợp, nên các lần chạy gần như không trùng tên.
 */
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Trương', 'Đinh', 'Lâm', 'Mai']
const DEM = ['Văn', 'Thị', 'Minh', 'Thanh', 'Ngọc', 'Quốc', 'Gia', 'Hoài', 'Thu', 'Đức', 'Hải', 'Anh', 'Bảo', 'Khánh', 'Hữu', 'Tuấn', 'Thùy', 'Phương']
const DEM2 = ['An', 'Bảo', 'Diệu', 'Hoàng', 'Kim', 'Mỹ', 'Nhật', 'Phương', 'Quang', 'Thiên', 'Thúy', 'Trúc', 'Tường', 'Xuân', 'Yến']
const TEN = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hiếu', 'Hùng', 'Khoa', 'Lan', 'Linh', 'Long', 'Mai', 'Nam', 'Nga', 'Phong', 'Phúc',
  'Quân', 'Quỳnh', 'Sơn', 'Tâm', 'Thảo', 'Trang', 'Trung', 'Tuấn', 'Uyên', 'Việt', 'Vy', 'Yến', 'Hạnh', 'Khang', 'Nhi', 'Duy', 'Thịnh']

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]

export function personName(): string {
  return `${pick(HO)} ${pick(DEM)} ${pick(DEM2)} ${pick(TEN)}`
}
