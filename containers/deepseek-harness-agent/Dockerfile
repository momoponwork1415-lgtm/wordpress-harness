FROM node@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7

WORKDIR /opt/deepseek-harness

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev \
    && npm cache clean --force

ENV PATH="/opt/deepseek-harness/node_modules/.bin:${PATH}"

CMD ["dsh", "--version"]
