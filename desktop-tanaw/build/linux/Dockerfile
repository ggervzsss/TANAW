FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils python3 build-essential pkg-config patchelf rsync \
    libgl1 libglib2.0-0 libgomp1 libnss3 libnspr4 libgtk-3-0 libxss1 libxtst6 \
    libatspi2.0-0 libasound2 libuuid1 libgbm1 libsecret-1-0 libsm6 libice6 xdg-utils binutils \
    dpkg-dev fakeroot lsof util-linux

# Match the existing Windows build tools; uv resolves the frozen Linux wheels.
RUN mkdir -p /opt/node /opt/uv && \
    curl -fsSLo /tmp/node.tar.xz https://nodejs.org/dist/v22.22.3/node-v22.22.3-linux-x64.tar.xz && \
    curl -fsSLo /tmp/SHASUMS256.txt https://nodejs.org/dist/v22.22.3/SHASUMS256.txt && \
    cd /tmp && sed -n 's/  node-v22.22.3-linux-x64.tar.xz$/  node.tar.xz/p' SHASUMS256.txt | sha256sum --check --strict && \
    tar -xJf node.tar.xz -C /opt/node --strip-components=1 && \
    curl -fsSLo /tmp/uv.tar.gz https://github.com/astral-sh/uv/releases/download/0.11.18/uv-x86_64-unknown-linux-gnu.tar.gz && \
    tar -xzf /tmp/uv.tar.gz -C /opt/uv --strip-components=1

ENV PATH="/opt/node/bin:/opt/uv:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV UV_PYTHON=3.12
WORKDIR /workspace/project
