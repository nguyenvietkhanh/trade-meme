# Dependency manifest

Tất cả pin trong requirements.txt. Cài từ PyPI qua pip. Không gọi các package registry khi scanner chạy.

| Package | Mục đích |
|---|---|
| annotated-types | Metadata/ràng buộc kiểu của Pydantic. |
| anyio | Lớp I/O của HTTPX. |
| bitarray | Kiểu bit cho eth-account. |
| certifi | CA bundle TLS của HTTPX. |
| ckzg | Phụ thuộc KZG của eth-account, scanner không dùng ký. |
| cytoolz | Hàm tiện ích C cho eth-utils. |
| eth-account | Account/signing dependency của SDK; không cung cấp key. |
| eth-hash | Hash Ethereum. |
| eth-keyfile | Định dạng keyfile trong eth-account, không đọc keyfile. |
| eth-keys | Kiểu khóa Ethereum bên trong SDK. |
| eth-rlp | Mã hóa RLP Ethereum. |
| eth-typing | Kiểu dữ liệu Ethereum. |
| eth-utils | Tiện ích encoding/địa chỉ SDK. |
| eth-abi | ABI encoding dependency SDK. |
| h11 | HTTP/1 protocol. |
| h2 | HTTP/2 protocol. |
| hexbytes | Dữ liệu hex Ethereum. |
| hpack | HTTP/2 header compression. |
| httpcore | Transport của HTTPX. |
| httpx[http2] | HTTP client của SDK, HTTP/2 extra. |
| hyperframe | HTTP/2 frames. |
| idna | Tên miền IDNA. |
| iniconfig | Phụ thuộc cấu hình của pytest. |
| packaging | Version metadata của pytest. |
| parsimonious | Parser cho eth-abi. |
| pluggy | Hook dependency của pytest. |
| poly-eip712-structs | EIP-712 types của SDK chính thức, không ký trong scanner. |
| py-clob-client-v2 | Client V2 chính thức, chỉ get_order_book public. |
| py-order-utils | Dependency order types của SDK chính thức; không tạo/gửi order. |
| pycryptodome | Primitive cryptographic dependency của SDK. |
| pydantic | Validation dependency eth-account. |
| pydantic-core | Engine của Pydantic. |
| pygments | Phụ thuộc hiển thị pytest. |
| pytest | Dependency được py-order-utils kéo vào; tests dự án dùng unittest. |
| regex | Parser dependency. |
| rlp | RLP codec. |
| toolz | Hàm tiện ích Ethereum. |
| typing-inspection | Kiểm tra type Pydantic. |
| typing-extensions | Typing compatibility. |
