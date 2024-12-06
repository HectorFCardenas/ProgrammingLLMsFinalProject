// contentScript.js

// Find all form elements on the page
const forms = document.querySelectorAll('form');
console.log('HELLO THERE!');

// Helper function to get the associated label text
function getAssociatedLabelText(input) {
  let labelText = '';

  // 1. Try to find a label using the 'for' attribute
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) {
      labelText = label.innerText.trim();
      return labelText;
    }
  }

  // 2. Check if the input is wrapped inside a label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    // Get the label's text content
    labelText = parentLabel.innerText.trim();

    // Optional: Remove the input's value from the label text
    // This helps if the label includes the input's current value
    if (input.value) {
      labelText = labelText.replace(input.value, '').trim();
    }

    return labelText;
  }

  // 3. If no label is found, return an empty string
  return labelText;
}

// Helper function to get surrounding text of the input field
function getSurroundingText(input) {
  let surroundingText = '';

  // Helper function to extract text from an element if it has meaningful text
  function getTextFromElement(element) {
    if (element && element.innerText && element.innerText.trim() !== '') {
      return element.innerText.trim();
    }
    return '';
  }

  // 1. Check previous siblings
  let prevSibling = input.previousElementSibling;
  while (prevSibling) {
    const text = getTextFromElement(prevSibling);
    if (text) {
      surroundingText += ' ' + text;
      break; // Stop after finding the first meaningful text
    }
    prevSibling = prevSibling.previousElementSibling;
  }

  // 2. Check next siblings
  let nextSibling = input.nextElementSibling;
  while (nextSibling) {
    const text = getTextFromElement(nextSibling);
    if (text) {
      surroundingText += ' ' + text;
      break;
    }
    nextSibling = nextSibling.nextElementSibling;
  }

  // 3. Check parent elements up to the body
  let parent = input.parentElement;
  while (parent && parent !== document.body) {
    const text = getTextFromElement(parent);
    if (text) {
      surroundingText += ' ' + text;
      // You might choose to continue climbing up or break here
      break;
    }
    parent = parent.parentElement;
  }

  return surroundingText.trim();
}

// Iterate over each form and collect detailed input information
const formDetails = [];

forms.forEach((form, formIndex) => {
  const formInfo = {
    action: form.action,
    method: form.method,
    inputs: [],
  };

  const inputs = form.querySelectorAll('input, textarea, select');

  inputs.forEach((input) => {

    const type = input.type || input.tagName.toLowerCase();
    if (type === 'hidden') {
      // Skip hidden inputs
      return;
    }

    const name = input.name || input.id || '';
    const value = input.value || '';
    const label = getAssociatedLabelText(input);
    const surroundingText = getSurroundingText(input);

    //console.log(`Found input: ${name}, type: ${type}`);
    //console.log(`Label: ${label}`);
    //console.log(`Surrounding Text: ${surroundingText}`);

    formInfo.inputs.push({
      name: name,
      type: type,
      value: value,
      label: label,
      surroundingText: surroundingText,
    });
  });

  formDetails.push(formInfo);
});

console.log('Forms on the page:', formDetails);

function parseResponses(responses) {
  const lines = responses.split('\n'); // Split the response into lines
  const parsedResponses = {};

  lines.forEach((line) => {
      const [question, answer] = line.split(/:\s+/); // Split by the first colon and space
      if (question && answer) {
          parsedResponses[question.trim()] = answer.trim(); // Add to the dictionary
      }
  });

  return parsedResponses;
}

async function handleResponses(responses) {
  console.log("Raw Responses:", responses);

  // Parse the responses into a dictionary
  const parsedResponses = parseResponses(responses);
  console.log("Parsed Responses:", parsedResponses);

  // Iterate over the parsed responses
  for (const [formName, value] of Object.entries(parsedResponses)) {
      formDetails.forEach((formInfo) => {
          // Find the input in the form that matches the formName
          const matchingInput = formInfo.inputs.find(
              (input) =>
                  input.name === formName ||
                  input.label === formName ||
                  input.surroundingText.includes(formName)
          );

          if (matchingInput) {
              // Update the input field value
              const inputElement = document.querySelector(
                  `input[name="${matchingInput.name}"], textarea[name="${matchingInput.name}"], select[name="${matchingInput.name}"]`
              );

              if (inputElement) {
                  inputElement.value = value; // Assign the value
                  console.log(`Assigned "${value}" to input "${formName}"`);
              }
          }
      });
  }
}


async function callFormAPI(forms) {
  try {
      const response = await fetch("http://127.0.0.1:5000/api/formcall", {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({ forms }), // Send forms as JSON
      });

      if (!response.ok) {
          throw new Error(`Error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Assistant Messages:', data.messages);
      console.log('Responses:', data.responses);
      handleResponses(data.responses)

      // Handle the messages and responses as needed
      return data;
  } catch (error) {
      console.error('Error calling the API:', error.message);
  }
}

if (Array.isArray(formDetails) && formDetails.length > 0) {
  callFormAPI(formDetails);
}

let currentURL = window.location.href;

function detectPageChange() {
    if (currentURL !== window.location.href) {
        currentURL = window.location.href;
        console.log('Page changed to:', currentURL);

        // Send a message to the background script to reset the thread
        chrome.runtime.sendMessage({ type: 'resetThread' });
    }
}

// Use a MutationObserver to detect changes in SPAs
const observer = new MutationObserver(detectPageChange);
observer.observe(document, { subtree: true, childList: true });

// Handle traditional page loads
window.addEventListener('DOMContentLoaded', () => {
    console.log('Page loaded:', window.location.href);
    chrome.runtime.sendMessage({ type: 'resetThread' });
});



let lastHighlightedTextbox = null;

// Add an event listener for clicks on the document
document.addEventListener('click', (event) => {
    // Check if the clicked element is a text box
    if (event.target.tagName === 'INPUT' && event.target.type === 'text') {
        // Unhighlight the previously highlighted text box, if any
        if (lastHighlightedTextbox) {
            lastHighlightedTextbox.style.backgroundColor = ''; // Reset background
        }

        // Highlight the newly clicked text box
        event.target.style.backgroundColor = 'yellow';

        // Update the reference to the currently highlighted text box
        lastHighlightedTextbox = event.target;
    }
});

function captureFormDetails() {
  const forms = document.querySelectorAll("form");
  const formDetails = [];

  forms.forEach((form) => {
      const formInfo = {
          action: form.action,
          method: form.method,
          inputs: [],
      };

      const inputs = form.querySelectorAll("input, textarea, select");
      inputs.forEach((input) => {
          const type = input.type || input.tagName.toLowerCase();
          if (type === "hidden") return;

          const name = input.name || input.id || "";
          const value = input.value || "";
          const label = getAssociatedLabelText(input);
          const surroundingText = getSurroundingText(input);

          formInfo.inputs.push({
              name,
              type,
              value,
              label,
              surroundingText,
          });
      });

      formDetails.push(formInfo);
  });

  return formDetails;
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "requestFormDetails") {
      console.log("Received request for form details.");
      try {
          const formDetails = captureFormDetails(); // Ensure this function exists
          console.log("Captured form details:", formDetails);
          sendResponse({ status: "success", data: formDetails }); // Always send a response
      } catch (error) {
          console.error("Error capturing form details:", error);
          sendResponse({ status: "error", error: error.message });
      }
  }
  return true; // Keeps the port open for asynchronous responses
});
