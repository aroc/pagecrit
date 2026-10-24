'use strict';
document.querySelector('#start').addEventListener('click', async () => {
  const button = document.querySelector('#start');
  button.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) {
      throw new Error('Open a normal http or https web page first. Browser settings, PDFs and extension pages cannot be reviewed.');
    }
    const [inspection] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => ({
      modal: Boolean(document.querySelector('dialog:modal')),
      contentType: document.contentType
    })});
    if (inspection?.result?.modal) {
      throw new Error('Close the page’s modal dialog, then click Review this page again. Modal dialogs cover the review controls.');
    }
    if (!['text/html', 'application/xhtml+xml'].includes(inspection?.result?.contentType)) {
      throw new Error('This is not an HTML page. Open the website itself rather than a PDF, image, or browser document.');
    }
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['core.js', 'content.js']});
    window.close();
  } catch (error) {
    document.querySelector('#status').textContent = `Couldn't start: ${error.message}`;
    button.disabled = false;
  }
});
