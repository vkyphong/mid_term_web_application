/** Tên người Việt ngẫu nhiên cho tài khoản test (≈ 180 nghìn tổ hợp). */
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Trương', 'Đinh', 'Lâm', 'Mai']
const DEM = ['Văn', 'Thị', 'Minh', 'Thanh', 'Ngọc', 'Quốc', 'Gia', 'Hoài', 'Thu', 'Đức', 'Hải', 'Anh', 'Bảo', 'Khánh', 'Hữu', 'Tuấn', 'Thùy', 'Phương']
const DEM2 = ['An', 'Bảo', 'Diệu', 'Hoàng', 'Kim', 'Mỹ', 'Nhật', 'Phương', 'Quang', 'Thiên', 'Thúy', 'Trúc', 'Tường', 'Xuân', 'Yến']
const TEN = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hiếu', 'Hùng', 'Khoa', 'Lan', 'Linh', 'Long', 'Mai', 'Nam', 'Nga', 'Phong', 'Phúc',
  'Quân', 'Quỳnh', 'Sơn', 'Tâm', 'Thảo', 'Trang', 'Trung', 'Tuấn', 'Uyên', 'Việt', 'Vy', 'Yến', 'Hạnh', 'Khang', 'Nhi', 'Duy', 'Thịnh']

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]

export function personName(): string {
  return `${pick(HO)} ${pick(DEM)} ${pick(DEM2)} ${pick(TEN)}`
}

/** Tên nhóm kiểu công ty cho test; nơi tạo qua API thử lại khi trùng tên (409). */
const PHONG_BAN = ['Phát triển phần mềm', 'Sản phẩm', 'Thiết kế UI/UX', 'Kiểm thử (QA)', 'DevOps', 'An ninh mạng', 'Dữ liệu & AI',
  'Kinh doanh', 'Marketing', 'Nhân sự', 'Chăm sóc khách hàng', 'Kế toán', 'Frontend', 'Backend', 'Mobile']
const DU_AN = ['ERP', 'CRM', 'HRM', 'Ví điện tử', 'App Mobile', 'Website bán hàng', 'Chatbot CSKH', 'Data Warehouse', 'Cổng thanh toán',
  'Hệ thống đặt lịch', 'Nền tảng e-learning', 'Quản lý kho', 'Super App', 'Microservices', 'Cloud Migration', 'AI Assistant',
  'Hệ thống Loyalty', 'Dashboard BI', 'API Gateway', 'Design System']
const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

/** Tên dự án có mã (đủ ngẫu nhiên để dùng khi tạo nhóm qua giao diện). */
export function projectName(): string {
  return `Dự án ${pick(DU_AN)} DA-${between(1000, 9999)}`
}

export function groupName(): string {
  return Math.random() < 0.7 ? projectName() : `${pick(PHONG_BAN)} - Tổ ${between(1, 99)}`
}
