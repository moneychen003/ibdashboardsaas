#!/bin/bash

# IB 投资组合仪表盘启动脚本（Flask 后端 + React 前端）

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 启动 IB 投资组合仪表盘..."
echo "📂 工作目录：$SCRIPT_DIR"
echo ""

# 检查 Python
if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null; then
    PYTHON=python
else
    echo "❌ 错误：未找到 Python"
    exit 1
fi

# 检查 Flask
if ! $PYTHON -c "import flask" 2>/dev/null; then
    echo "📦 正在安装 Flask..."
    $PYTHON -m pip install flask -q
fi

# 检查 Node.js（用于构建 React 前端）
if command -v npm &> /dev/null; then
    echo "📦 检查 React 前端依赖..."
    cd "$SCRIPT_DIR/web"
    if [ ! -d "node_modules" ]; then
        echo "  正在安装 npm 依赖..."
        npm install
    fi
    echo "🔨 构建 React 前端..."
    npm run build
    cd "$SCRIPT_DIR"
else
    echo "⚠️  未找到 Node.js，跳过前端构建"
fi

# 启动 Flask 服务器
PORT=8080
echo ""
echo "🌐 打开浏览器访问：http://localhost:$PORT"
echo "⚠️  按 Ctrl+C 停止服务"
echo ""

$PYTHON server.py
