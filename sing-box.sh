#!/bin/bash

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
PLAIN='\033[0m'

# 版本信息
VERSION="1.0.0"
SERVICE_NAME="sing-box"
CONFIG_FILE="/usr/local/etc/sing-box/config.json"
BINARY_PATH="/usr/local/bin/sing-box"
SYSTEMD_SERVICE="/etc/systemd/system/${SERVICE_NAME}.service"

# 加密方式列表
CIPHERS=(
    "aes-128-gcm"
    "aes-256-gcm"
    "chacha20-poly1305"
    "none"
)

# 协议列表
PROTOCOLS=(
    "shadowsocks"
    "trojan"
    "vmess"
    "vless"
    "hysteria2"
)

install() {
    # 检查是否已安装
    if [ -f "$BINARY_PATH" ]; then
        echo -e "${RED}检测到已安装sing-box，如需重新安装请先卸载${PLAIN}"
        exit 1
    fi

    # 安装依赖
    if command -v apt &> /dev/null; then
        apt update && apt install -y curl wget qrencode
    elif command -v yum &> /dev/null; then
        yum install -y curl wget qrencode
    else
        echo -e "${RED}不支持的包管理器${PLAIN}"
        exit 1
    fi

    # 下载二进制文件
    local VERSION_LATEST=$(curl -s "https://api.github.com/repos/SagerNet/sing-box/releases/latest" | grep "tag_name" | awk -F '"' '{print $4}')
    local DOWNLOAD_URL="https://github.com/SagerNet/sing-box/releases/download/${VERSION_LATEST}/sing-box-${VERSION_LATEST}-linux-amd64.tar.gz"
    
    mkdir -p /tmp/sing-box
    wget -O /tmp/sing-box/sing-box.tar.gz ${DOWNLOAD_URL}
    tar -xzf /tmp/sing-box/sing-box.tar.gz -C /tmp/sing-box
    mv /tmp/sing-box/sing-box-${VERSION_LATEST}-linux-amd64/sing-box ${BINARY_PATH}
    chmod +x ${BINARY_PATH}
    rm -rf /tmp/sing-box

    # 创建配置文件
    read -p "请输入连接端口 [默认: 8388]: " PORT
    PORT=${PORT:-8388}
    
    read -p "请选择加密方式 [${CIPHERS[*]}] (默认: aes-128-gcm): " CIPHER
    CIPHER=${CIPHER:-aes-128-gcm}
    
    while [[ ! " ${CIPHERS[@]} " =~ " ${CIPHER} " ]]; do
        echo -e "${RED}不支持的加密方式${PLAIN}"
        read -p "请选择加密方式 [${CIPHERS[*]}]: " CIPHER
    done
    
    read -p "请输入密码（留空随机生成）: " PASSWORD
    PASSWORD=${PASSWORD:-$(tr -dc 'a-zA-Z0-9' < /dev/urandom | fold -w 16 | head -n 1)}
    
    read -p "请选择协议 [${PROTOCOLS[*]}] (默认: shadowsocks): " PROTOCOL
    PROTOCOL=${PROTOCOL:-shadowsocks}

    # 生成配置文件
    cat > ${CONFIG_FILE} <<EOF
{
  "log": {
    "level": "info"
  },
  "inbounds": [
    {
      "type": "${PROTOCOL}",
      "listen": "::",
      "listen_port": ${PORT},
      "users": [
        {
          "name": "default",
          "password": "${PASSWORD}"
        }
      ],
      "shadowsocks": {
        "method": "${CIPHER}"
      }
    }
  ],
  "outbounds": [
    {
      "type": "direct"
    }
  ]
}
EOF

    # 创建systemd服务
    cat > ${SYSTEMD_SERVICE} <<EOF
[Unit]
Description=sing-box service
After=network.target nss-lookup.target

[Service]
User=root
WorkingDirectory=/usr/local/etc/sing-box/
ExecStart=${BINARY_PATH} run -c ${CONFIG_FILE}
Restart=on-failure
RestartSec=10
LimitNOFILE=infinity

[Install]
WantedBy=multi-user.target
EOF

    # 启动服务
    systemctl daemon-reload
    systemctl enable --now ${SERVICE_NAME}
    
    # 显示配置信息
    clear
    echo -e "${GREEN}安装完成！配置信息：${PLAIN}"
    echo "-----------------------------------"
    echo "协议: ${PROTOCOL}"
    echo "端口: ${PORT}"
    echo "密码: ${PASSWORD}"
    echo "加密方式: ${CIPHER}"
    echo "服务器IP: $(curl -s ipv4.icanhazip.com)"
    echo "-----------------------------------"
    echo -e "SS链接：ss://$(echo -n "${CIPHER}:${PASSWORD}@$(curl -s ipv4.icanhazip.com):${PORT}" | base64 -w0)"
    qrencode -t ansiutf8 "ss://${CIPHER}:${PASSWORD}@$(curl -s ipv4.icanhazip.com):${PORT}"
}

update() {
    if [ ! -f "${BINARY_PATH}" ]; then
        echo -e "${RED}未检测到安装的sing-box${PLAIN}"
        exit 1
    fi

    local CURRENT_VERSION=$(${BINARY_PATH} version | awk '{print $3}')
    local LATEST_VERSION=$(curl -s "https://api.github.com/repos/SagerNet/sing-box/releases/latest" | grep "tag_name" | awk -F '"' '{print $4}')

    if [ "${CURRENT_VERSION}" == "${LATEST_VERSION}" ]; then
        echo -e "${GREEN}当前已是最新版本${PLAIN}"
        exit 0
    fi

    echo -e "${YELLOW}开始更新：${CURRENT_VERSION} -> ${LATEST_VERSION}${PLAIN}"
    
    # 下载新版本
    local DOWNLOAD_URL="https://github.com/SagerNet/sing-box/releases/download/${LATEST_VERSION}/sing-box-${LATEST_VERSION}-linux-amd64.tar.gz"
    
    mkdir -p /tmp/sing-box
    wget -O /tmp/sing-box/sing-box.tar.gz ${DOWNLOAD_URL}
    tar -xzf /tmp/sing-box/sing-box.tar.gz -C /tmp/sing-box
    mv /tmp/sing-box/sing-box-${LATEST_VERSION}-linux-amd64/sing-box ${BINARY_PATH}
    chmod +x ${BINARY_PATH}
    rm -rf /tmp/sing-box

    # 重启服务
    systemctl restart ${SERVICE_NAME}
    echo -e "${GREEN}更新完成！当前版本：${LATEST_VERSION}${PLAIN}"
}

uninstall() {
    if [ ! -f "${BINARY_PATH}" ]; then
        echo -e "${RED}未检测到安装的sing-box${PLAIN}"
        exit 1
    fi

    systemctl stop ${SERVICE_NAME}
    systemctl disable ${SERVICE_NAME}
    rm -f ${BINARY_PATH} ${CONFIG_FILE} ${SYSTEMD_SERVICE}
    echo -e "${GREEN}卸载完成！配置文件已保留，如需删除请手动删除${CONFIG_FILE}${PLAIN}"
}

show_menu() {
    clear
    echo "-----------------------------------"
    echo "  sing-box 一键管理脚本 v${VERSION}  "
    echo "-----------------------------------"
    echo "1. 安装 sing-box"
    echo "2. 更新 sing-box"
    echo "3. 卸载 sing-box"
    echo "0. 退出脚本"
    echo "-----------------------------------"
    read -p "请选择操作 [0-3]: " choice
    case $choice in
        1) install ;;
        2) update ;;
        3) uninstall ;;
        0) exit 0 ;;
        *) echo "无效选项" && sleep 2 && show_menu ;;
    esac
}

# 主程序入口
if [ "$#" -eq 0 ]; then
    show_menu
else
    case $1 in
        install) install ;;
        update) update ;;
        uninstall) uninstall ;;
        *) echo "无效参数" && exit 1 ;;
    esac
fi
