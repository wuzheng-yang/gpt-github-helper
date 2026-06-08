---
name: mimo-worker
description: 调用本地小米模型代码修改服务，让小米模型直接改代码，Codex 负责验收。
---

# Mimo Worker

Codex 负责找相关文件、下发任务、运行检查和验收。小米模型负责直接修改代码。

## 使用场景

适合：
- 小范围功能实现
- 局部 bug 修复
- 补充简单逻辑
- 修复构建或类型错误
- 用户允许错了重写

不适合：
- 密钥、凭证、生产配置
- 大范围架构重构
- 权限、认证、安全核心逻辑
- 一次修改整个项目

## 调用方式

优先使用：

```bash
python tools/mimo/mimo_cli.py --task "任务描述" --files "file1,file2"
```

只改一两行时可指定：

```bash
python tools/mimo/mimo_cli.py --task "任务描述" --files "file1,file2" --mode edit
```

文件较小或结构变化较大时可指定：

```bash
python tools/mimo/mimo_cli.py --task "任务描述" --files "file1,file2" --mode replace_file
```

如果上次构建报错，把错误作为补充上下文：

```bash
python tools/mimo/mimo_cli.py --task "根据报错修复问题" --files "file1,file2" --extra-context "错误日志"
```

## 验收

小米模型写完后，Codex 运行合适检查：

```bash
npm run build
npm run lint
npm run test
pytest
mvn test
```

检查失败时，Codex 把错误日志通过 `--extra-context` 发回小米模型重修。

## 策略

- 每次只传 1 到 5 个相关文件。
- 不强制每次 git diff。
- 复杂任务先拆成小任务。
- 不要让小米模型处理密钥、凭证、生产配置。
