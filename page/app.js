// Static Magpie pages cannot run inline scripts or fetch a local service.
// The official bridge sends the hello handshake and exposes plugin options.
(async () => {
  const button = document.querySelector('#open');
  const status = document.querySelector('#status');
  let timer;
  try {
    if (!globalThis.magpie) throw new Error('Magpie 页面桥未加载，请更新 Magpie 并重新打开插件页面。');
    const opts = await Promise.race([
      (async () => { await magpie.ready; return await magpie.options.get(); })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Magpie 初始化超时，请关闭并重新打开插件页面。')), 8000);
      }),
    ]);
    clearTimeout(timer);
    const port = opts.port ?? 18991;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('本地服务端口必须是 1024–65535 的整数，请检查插件选项。');
    }
    if (opts.controlToken !== undefined && opts.controlToken !== '' &&
        (typeof opts.controlToken !== 'string' || !/^[0-9a-f]{64}$/.test(opts.controlToken))) {
      throw new Error('本地控制密钥格式无效，请检查插件选项。');
    }
    button.textContent = opts.controlToken ? '打开设置' : '创建本地控制密钥';
    button.disabled = false;
    button.onclick = async () => {
      button.disabled = true;
      try {
        if (!opts.controlToken) {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          await magpie.options.set({
            ...opts,
            controlToken: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
          });
          status.textContent = '已保存。插件宿主正在重启，请关闭并重新打开本页。';
          return;
        }
        let target = new URL(`http://127.0.0.1:${port}/`);
        if (magpie.service) {
          // Official pageservice.go exposes only this page token's proxy root.
          // Never send the control secret to another origin or plugin's service.
          const current = new URL(location.href);
          const root = current.pathname.match(/^(.*\/_magpie\/plugin\/[^/]+\/)/)?.[1];
          const service = new URL(magpie.service, current);
          if (!root || !['http:', 'https:'].includes(current.protocol) ||
              service.origin !== current.origin || service.username || service.password ||
              service.pathname !== root + '_magpie/service/' || service.search || service.hash) {
            throw new Error('不可信的 Magpie 服务地址');
          }
          target = service;
        }
        target.hash = opts.controlToken;
        location.replace(target.href);
      } catch {
        status.textContent = '无法打开，请检查插件是否启用，然后重新打开页面。';
        button.disabled = false;
      }
    };
  } catch (error) {
    button.textContent = '初始化失败';
    status.textContent = error.message || '初始化失败，请关闭并重新打开插件页面。';
  } finally {
    clearTimeout(timer);
  }
})();
