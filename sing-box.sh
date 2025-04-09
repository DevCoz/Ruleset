#!/bin/bash

# 安装依赖
install_deps() {
    if ! command -v curl &> /dev/null; then
        apt update && apt install -y curl
    fi
}

# 安装 sing-box
install_singbox() {
    echo "正在安装 sing-box..."
    bash <(curl -Ls https://raw.githubusercontent.com/233boy/sing-box/master/install.sh)
    if [ $? -ne 0 ]; then
        echo "安装失败，请检查网络"
        exit 1
    fi
}

# 配置 Shadowsocks 协议
config_ss() {
    read -p "请输入 Shadowsocks 端口 (默认 8388): " PORT
    PORT=${PORT:-8388}
    read -p "请输入 Shadowsocks 密码 (默认随机生成): " PASSWORD
    PASSWORD=${PASSWORD:-$(openssl rand -base64 16)}
    echo "请选择加密方式:"
    echo "1. aes-256-gcm"
    echo "2. chacha20-poly1305 (推荐)"
    read -p "输入选项 (1/2，默认 2): " CIPHER
    CIPHER=$( [ "$CIPHER" == "1" ] && echo "aes-256-gcm" || echo "chacha20-poly1305" )

    # 生成配置文件
    cat > /usr/local/etc/sing-box/config.json <<EOF
{
  "inbounds": [
    {
      "type": "shadowsocks",
      "listen": "::",
      "port": $PORT,
      "method": "$CIPHER",
      "password": "$PASSWORD",
      "network": "tcp,udp",
      "udp_over_tcp": true
    }
  ],
  "outbounds": [
    {
      "type": "direct"
    }
  ]
}
EOF
    echo "配置完成！Shadowsocks 参数如下："
    echo "端口: $PORT"
    echo "密码: $PASSWORD"
    echo "加密: $CIPHER"
}

# 更新 sing-box
update_singbox() {
    echo "正在更新 sing-box..."
    systemctl stop sing-box
    curl -L https://github.com/233boy/sing-box/releases/latest/download/sing-box-linux-amd64.deb -o /tmp/sing-box.deb
    dpkg -i /tmp/sing-box.deb
    systemctl start sing-box
    echo "更新完成！"
}

# 卸载 sing-box
uninstall_singbox() {
    read -p "确定卸载 sing-box？(y/n): " CONFIRM
    if [ "$CONFIRM" == "y" ]; then
        systemctl stop sing-box
        rm -rf /usr/local/etc/sing-box /usr/local/bin/sing-box
        rm -f /etc/systemd/system/sing-box.service
        echo "卸载完成！"
    fi
}

# 主菜单
main() {
    install_deps
    echo "sing-box 一键管理脚本"
    echo "1. 安装并配置 Shadowsocks"
    echo "2. 更新 sing-box"
    echo "3. 卸载 sing-box"
    read -p "请选择操作 (1/2/3): " OPTION
    case $OPTION in
        1) install_singbox && config_ss ;;
        2) update_singbox ;;
        3) uninstall_singbox ;;
        *) echo "无效选项" ;;
    esac
}

main
