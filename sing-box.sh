#!/bin/bash

# 颜色定义
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
BLUE='\033[34m'
PLAIN='\033[0m'

# 基础配置
CONFIG_FILE="/etc/sing-box/config.json"
SERVICE_FILE="/etc/systemd/system/sing-box.service"
BINARY_PATH="/usr/local/bin/sing-box"
UUID=$(cat /proc/sys/kernel/random/uuid)
WG_PORT=443

# 协议选项
PROTOCOL_LIST=("vmess" "vless" "trojan" "shadowsocks" "hysteria2")
ENCRYPTIONS=(
    "none"
    "aes-128-gcm"
    "chacha20-poly1305"
    "aes-256-gcm"
    "2022-blake3-aes-128-gcm"
    "2022-blake3-chacha20-poly1305"
)

# 安装函数
install_singbox() {
    if [ -f "$BINARY_PATH" ]; then
        echo -e "${YELLOW}检测到已安装 Sing-Box，是否覆盖安装？(y/n)${PLAIN}"
        read -p "输入选择: " confirm
        [ "$confirm" != "y" ] && exit 1
    fi

    # 检测系统架构
    case $(uname -m) in
        x86_64) ARCH="amd64";;
        aarch64) ARCH="arm64";;
        *) echo -e "${RED}不支持的架构${PLAIN}" && exit 1;;
    esac

    # 下载最新版本
    LATEST_VER=$(curl -s "https://api.github.com/repos/SagerNet/sing-box/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
    DOWNLOAD_URL="https://github.com/SagerNet/sing-box/releases/download/${LATEST_VER}/sing-box-${LATEST_VER#v}-linux-${ARCH}.tar.gz"
    
    wget -qO- $DOWNLOAD_URL | tar xz -C /tmp
    mv /tmp/sing-box-*/sing-box $BINARY_PATH
    chmod +x $BINARY_PATH

    # 创建配置目录
    mkdir -p /etc/sing-box
}

# 生成配置文件
generate_config() {
    echo -e "${BLUE}选择协议：${PLAIN}"
    select protocol in "${PROTOCOL_LIST[@]}"; do
        break
    done

    echo -e "${BLUE}选择加密方式：${PLAIN}"
    select encryption in "${ENCRYPTIONS[@]}"; do
        break
    done

    read -p "输入监听端口 [默认:443]: " port
    WG_PORT=${port:-443}

    read -p "输入密码/UUID [默认随机生成]: " password
    PASSWORD=${password:-$UUID}

    # 生成配置模板
    cat > $CONFIG_FILE <<EOF
{
  "log": {
    "level": "info"
  },
  "inbounds": [
    {
      "type": "${protocol}",
      "listen": "::",
      "port": ${WG_PORT},
      "settings": {
        "clients": [
          {
            "uuid": "${PASSWORD}",
            "password": "${PASSWORD}",
            "encryption": "${encryption}"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp"
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

    echo -e "${GREEN}配置文件已生成，UUID/密码：${PASSWORD}${PLAIN}"
}

# 设置系统服务
setup_service() {
    cat > $SERVICE_FILE <<EOF
[Unit]
Description=Sing-Box Service
After=network.target

[Service]
User=root
ExecStart=${BINARY_PATH} run -c ${CONFIG_FILE}
Restart=on-failure
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now sing-box
}

# 更新函数
update_singbox() {
    if [ ! -f "$BINARY_PATH" ]; then
        echo -e "${RED}未检测到 Sing-Box 安装${PLAIN}"
        exit 1
    fi

    CURRENT_VER=$($BINARY_PATH version | head -n1 | cut -d' ' -f3)
    LATEST_VER=$(curl -s "https://api.github.com/repos/SagerNet/sing-box/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

    if [ "$CURRENT_VER" = "$LATEST_VER" ]; then
        echo -e "${GREEN}当前已是最新版本${PLAIN}"
        exit 0
    fi

    install_singbox
    systemctl restart sing-box
    echo -e "${GREEN}已更新到 ${LATEST_VER}${PLAIN}"
}

# 卸载函数
uninstall_singbox() {
    systemctl stop sing-box
    systemctl disable sing-box
    rm -f $BINARY_PATH $SERVICE_FILE
    rm -rf /etc/sing-box

    echo -e "${GREEN}卸载完成，配置文件已保留${PLAIN}"
    read -p "是否删除配置文件？(y/n): " confirm
    [ "$confirm" = "y" ] && rm -rf /etc/sing-box
}

# 主菜单
show_menu() {
    echo -e "
    ${YELLOW}Sing-Box 一键管理脚本${PLAIN}
    ${GREEN}1.${PLAIN} 安装并配置
    ${GREEN}2.${PLAIN} 更新
    ${GREEN}3.${PLAIN} 卸载
    ${GREEN}0.${PLAIN} 退出
    "
    read -p "请输入选项: " choice

    case $choice in
        1) 
            install_singbox
            generate_config
            setup_service
            ;;
        2) update_singbox ;;
        3) uninstall_singbox ;;
        0) exit 0 ;;
        *) echo "无效选项" && sleep 1 ;;
    esac
}

# 主程序入口
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用 root 权限执行此脚本${PLAIN}"
    exit 1
fi

show_menu
