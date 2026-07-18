FROM apify/actor-node:22

COPY --chown=myuser:myuser package*.json ./

# impit's native binary ships via napi-rs optionalDependencies.
# Do NOT use --omit=optional here — it silently skips the binary.
RUN npm --quiet set progress=false \
    && npm install --omit=dev \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

COPY --chown=myuser:myuser . ./

CMD npm start --silent
