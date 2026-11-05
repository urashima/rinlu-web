# RINLU 用户系统

- [x] 检查身份来源：匿名无管理员身份；已有浏览器保留自己的登录会话。
- [x] 邮箱注册与密码登录；新用户默认粉丝，不允许提交特权角色。
- [x] 独立 HttpOnly 会话；退出当前设备、退出所有设备、密码修改撤销旧会话。
- [x] 账户昵称编辑；已有 ChatGPT 账户通过原身份验证首次设置密码。
- [x] 保留四种角色：粉丝、音乐人、审核员、管理员；管理员用户列表与权限编辑。
- [x] 所有者账户不可被其他管理员降权或停用。
- [x] Google OAuth 服务端授权码流程、一次性 state、已验证邮箱检查；不同登录账户不自动按邮箱合并。
- [ ] Google 正式启用：需要所有者配置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET，并登记回调 https://sonora-independent-music.kai-ma.chatgpt.site/api/accounts/google-callback。
- [ ] 双站发布及实际验收。

密码以 PBKDF2-SHA256（100000 次，独立随机盐）保存，不保存明文。Google 未配置时明确提示暂未开放。密码找回邮件不在本次已完成范围。

Release candidate: a1c3ed23283bf42312e973458ccee8d289f3c2cb; source SHA256 afb387bd2f3f17eb77f8b86c67ace7575c397043918aa0526c15518e46ce3ce2.
