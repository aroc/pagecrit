'use strict';
document.querySelector('#start').addEventListener('click', async () => {
  const button = document.querySelector('#start');
  button.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) {
      throw new Error('Open a normal http or https web page first. Browser settings, PDFs and extension pages cannot be reviewed.');
    }
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['core.js', 'content.js']});
    window.close();
  } catch (error) {
    document.querySelector('#status').textContent = `Couldn't start: ${error.message}`;
    button.disabled = false;
  }
});
