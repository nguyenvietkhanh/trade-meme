# Dependency manifest

Tất cả pin trong requirements.txt. Cài từ PyPI qua pip. Không gọi các package registry khi chương trình chạy. SDK và chữ ký chạy local; AI chỉ gọi River khi bật phần AI.

| Package | Mục đích |
|---|---|
| annotated-types | Metadata/ràng buộc kiểu của Pydantic. |
| anyio | Lớp I/O của HTTPX. |
| bitarray | Kiểu bit cho eth-account. |
| certifi | CA bundle TLS của HTTPX. |
| ckzg | Phụ thuộc KZG của eth-account, scanner không dùng ký; chế độ AI live ký local. |
| cytoolz | Hàm tiện ích C cho eth-utils. |
| eth-account | Account/signing dependency của SDK; AI live dùng signer do bạn cấu hình local. |
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
| pycryptodome | Primitive cryptographic dependency của SDK. |
| pydantic | Validation dependency eth-account. |
| pydantic-core | Engine của Pydantic. |
| pygments | Phụ thuộc hiển thị pytest. |
| pytest | Công cụ kiểm thử; tests dự án dùng unittest. |
| regex | Parser dependency. |
| rlp | RLP codec. |
| toolz | Hàm tiện ích Ethereum. |
| typing-inspection | Kiểm tra type Pydantic. |
| typing-extensions | Typing compatibility. |

| playwright | Microsoft Playwright điều khiển Chrome riêng cho public API và transport SDK có kiểm soát. |
| pyee | Event emitter của Playwright. |
| greenlet | Sync API coroutine bridge của Playwright. |

| polymarket-client | SDK hợp nhất chính thức Polymarket 0.14.0; public data, auth, ký và gửi FOK khi bật live rõ ràng. |
| msgpack | Codec phụ thuộc SDK hợp nhất. |
| websockets | WebSocket transport phụ thuộc SDK; vòng AI hiện dùng snapshots HTTP. |

Nguồn SDK: https://github.com/Polymarket/py-sdk và https://pypi.org/project/polymarket-client/0.14.0/. Wheel `polymarket_client-0.14.0-py3-none-any.whl` SHA-256: `e8ece00390315227c1a64ac103081be90befb9b6c14fac484ada2acbaea114ea`.
