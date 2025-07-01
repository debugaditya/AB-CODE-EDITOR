document.addEventListener('DOMContentLoaded', () => {
    const dropBtn = document.querySelector('.dropbtn');
    const menu = document.querySelector('.dropdown-menu');
    const dropdown = document.querySelector('.dropdown-content');
    const textarea = document.getElementById('codeEditor');

    const mp = {
        "cpp": "cpp.txt",
        "c": "c.txt",
        "python": "python.txt",
        "java": "java.txt",
        "javascript": "javascript.txt",
        "html": "html.txt", // This will trigger HTML formatting
        "css": "css.txt"
    };

    const TAB_SIZE = 4; // Number of spaces for a tab

    // --- Copilot/Suggestion Related Variables ---
    let currentActiveElement = null; // Store the currently focused textarea/editable div
    let ghostSpan = null;
    let currentSnippet = "";
    let fullCode = "";
    let lastPrompt = "";
    let debounceTimer = null; // Timer for delaying API calls
    let focusOutTimer = null; // Timer for debouncing focusout

    // Helper function to get leading spaces
    const getLeadingSpaces = (line) => {
        const match = line.match(/^\s*/);
        return match ? match[0].length : 0;
    };

    // --- Basic HTML Indentation Function (kept as utility, not used on load) ---
    function formatHtml(htmlString) {
        let indentLevel = 0;
        let formattedHtml = [];
        const lines = htmlString.split('\n');
        const indentStep = ' '.repeat(TAB_SIZE);

        lines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine.length === 0) {
                formattedHtml.push(''); // Keep blank lines
                return;
            }

            // Check for closing tags first to de-indent before adding the line
            // Matches </tag> or <!-- closing comment -->
            if (trimmedLine.match(/^\s*<\//) || trimmedLine.startsWith('<!--') && trimmedLine.endsWith('-->')) {
                indentLevel = Math.max(0, indentLevel - 1);
            }

            formattedHtml.push(indentStep.repeat(indentLevel) + trimmedLine);

            // Check for opening tags to indent for the next line
            // Matches <tag> or <tag attr="value"> but not self-closing <tag/>
            // Excludes common self-closing tags and SVG elements that don't need indentation
            if (trimmedLine.match(/<[a-zA-Z0-9]+[^>]*[^/]>$/) &&
                !trimmedLine.match(/<\/(?!svg|path|g|circle|rect|line|polygon|polyline|ellipse|text|image|foreignObject|use|defs|clipPath|mask|pattern|symbol|marker|view|style|script|title|desc|metadata|filter|feBlend|feColorMatrix|feComponentTransfer|feComposite|feConvolveMatrix|feDiffuseLighting|feDisplacementMap|feFlood|feGaussianBlur|feImage|feMerge|feMorphology|feOffset|feSpecularLighting|feTile|feTurbulence|linearGradient|radialGradient|stop|animate|animateMotion|animateTransform|set|mpath|altGlyph|color-profile|cursor|font|font-face|font-face-format|font-face-name|font-face-src|font-face-uri|hkern|vkern|missing-glyph|tref|altGlyphDef|altGlyphItem|glyph|glyphRef|textPath|tspan|view|a)\s*$/) &&
                !trimmedLine.endsWith('/>')) { // Also explicitly check for /> for self-closing
                indentLevel++;
            }
        });
        return formattedHtml.join('\n');
    }
    // --- END Basic HTML Indentation Function ---


    // Toggle dropdown on button click
    dropBtn.addEventListener('click', () => {
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });

    // Hide dropdown if clicked outside
    window.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    // Handle language selection
    document.querySelectorAll('.dropdown-menu a').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            const lang = item.textContent;
            const id = item.id;
            dropBtn.textContent = lang;

            const fileName = mp[id];
            if (!fileName) return;

            try {
                const res = await fetch(fileName);
                let code = await res.text(); // Get the raw code

                // Removed: Apply HTML formatting if it's an HTML file on load
                // if (id === 'html') {
                //     code = formatHtml(code);
                // }

                textarea.value = code;
            } catch (err) {
                console.error("Error loading file:", err);
                textarea.value = `// Failed to load ${fileName}`;
            } finally {
                menu.style.display = 'none'; // Hide dropdown after selection
            }
        });
    });

    // --- Global Event Listeners for Focus (Now within DOMContentLoaded) ---
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    // MutationObserver to ensure new elements (if dynamically added) get listeners
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' || mutation.type === 'attributes') {
                if (document.activeElement &&
                    (document.activeElement.tagName === "TEXTAREA" || document.activeElement.getAttribute("contenteditable") === "true") &&
                    document.activeElement !== currentActiveElement) {
                    handleFocusIn({ target: document.activeElement });
                }
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });


    function handleFocusIn(event) {
        const target = event.target;
        console.log("FocusIn detected. Target:", target);
        if (target.tagName === "TEXTAREA" || target.getAttribute("contenteditable") === "true") {
            // If focus moves to a new monitored element, hide previous suggestion if any
            if (currentActiveElement && currentActiveElement !== target) {
                hideSuggestion();
            }
            currentActiveElement = target;
            setupElementListeners(currentActiveElement);
            onInput(); // Trigger initial suggestion if text exists
        } else {
            // If focus moves out of a monitored element to a non-monitored one
            if (currentActiveElement) {
                console.log("Focus moving out of a monitored element. New target:", target);
                hideSuggestion();
                currentActiveElement = null; // Clear the reference
            }
        }
    }

    function handleFocusOut(event) {
        const relatedTarget = event.relatedTarget; // The element that focus is moving TO
        console.log("FocusOut detected. Target:", event.target, "Related Target:", relatedTarget);

        if (focusOutTimer) clearTimeout(focusOutTimer);
        focusOutTimer = setTimeout(() => {
            const newActiveElement = document.activeElement;
            console.log("FocusOut timeout checking. New active element:", newActiveElement);

            // Allow focus to move to the ghost span without hiding
            if (newActiveElement === ghostSpan) {
                console.log("Focus moved to ghost span, keeping active element.");
                return;
            }

            // Only clear if the new active element is genuinely outside our tracked elements
            if (newActiveElement !== currentActiveElement &&
                newActiveElement !== event.target && // Check if focus stayed on the same element unexpectedly
                (newActiveElement.tagName !== "TEXTAREA" && newActiveElement.getAttribute("contenteditable") !== "true")) { // Check if new active is *not* a target
                if (currentActiveElement) {
                    console.log("True blur detected, clearing active element.");
                    hideSuggestion();
                    currentActiveElement = null; // Clear the reference
                }
            }
        }, 150); // Increased delay slightly to 150ms
    }

    function setupElementListeners(element) {
        // Remove existing listeners to prevent duplicates
        element.removeEventListener("input", onInput);
        element.removeEventListener("keydown", onKeyDown);

        // Add listeners
        element.addEventListener("input", onInput);
        element.addEventListener("keydown", onKeyDown);

        if (!ghostSpan) {
            ghostSpan = document.createElement('span');
            ghostSpan.style.position = "absolute";
            ghostSpan.style.opacity = "0.4";
            ghostSpan.style.pointerEvents = "none";
            ghostSpan.style.color = "#999";
            ghostSpan.style.fontFamily = "monospace";
            ghostSpan.style.whiteSpace = "pre-wrap";
            ghostSpan.style.wordBreak = "break-word";
            ghostSpan.style.zIndex = "9999";
            ghostSpan.style.background = "transparent";
            ghostSpan.style.border = "none";
            document.body.appendChild(ghostSpan);
        }
        console.log("Copilot listeners set up for current active element:", element);
    }

    // --- Copilot/Suggestion Related Functions ---
    function showSuggestion(snippet) {
        console.log("Attempting to SHOW suggestion:", snippet);
        if (!currentActiveElement || !ghostSpan || !snippet) {
            console.log("SHOW aborted: Missing active element, or no snippet. currentActiveElement:", currentActiveElement, "ghostSpan:", ghostSpan, "snippet:", snippet);
            hideSuggestion();
            return;
        }
        currentSnippet = snippet;
        ghostSpan.textContent = snippet;
        ghostSpan.style.display = "block";
        positionGhostSpan();
        console.log("Suggestion should now be visible.");
        console.log("GhostSpan computed style (after show):", getComputedStyle(ghostSpan));
        console.log("GhostSpan textContent:", ghostSpan.textContent);
    }

    function hideSuggestion() {
        console.log("Attempting to HIDE suggestion.");
        if (ghostSpan) {
            ghostSpan.style.display = "none";
            ghostSpan.textContent = "";
        }
        currentSnippet = "";
        fullCode = "";
        lastPrompt = "";
        if (debounceTimer) clearTimeout(debounceTimer);
        console.log("Suggestion hidden.");
    }

    function positionGhostSpan() {
        if (!currentActiveElement || !ghostSpan) return;

        const textareaRect = currentActiveElement.getBoundingClientRect();
        const textareaStyle = window.getComputedStyle(currentActiveElement);

        const paddingTop = parseFloat(textareaStyle.paddingTop);
        const paddingLeft = parseFloat(textareaStyle.paddingLeft);
        const lineHeight = parseFloat(textareaStyle.lineHeight);
        const fontSize = parseFloat(textareaStyle.fontSize);

        // Fallback for lineHeight if it's 'normal' or invalid
        const actualLineHeight = lineHeight > 0 && !isNaN(lineHeight) ? lineHeight : fontSize * 1.2; // A common default multiplier

        const cursorPosition = currentActiveElement.selectionStart;
        const textBeforeCursor = currentActiveElement.value.substring(0, cursorPosition);
        const linesBeforeCursor = textBeforeCursor.split('\n');
        const currentLineNumber = linesBeforeCursor.length - 1; // 0-indexed
        const charsOnCurrentLineBeforeCursor = linesBeforeCursor[currentLineNumber].length;

        // Create a temporary element to measure character width accurately
        const tempMeasurer = document.createElement('span');
        tempMeasurer.style.position = 'absolute';
        tempMeasurer.style.visibility = 'hidden';
        tempMeasurer.style.fontFamily = textareaStyle.fontFamily;
        tempMeasurer.style.fontSize = textareaStyle.fontSize;
        tempMeasurer.style.lineHeight = textareaStyle.lineHeight;
        tempMeasurer.style.whiteSpace = 'pre'; // Important to measure width of spaces
        document.body.appendChild(tempMeasurer);

        // Measure the width of the text before the cursor on the current line
        tempMeasurer.textContent = linesBeforeCursor[currentLineNumber];
        const textWidthBeforeCursor = tempMeasurer.offsetWidth;
        document.body.removeChild(tempMeasurer); // Clean up

        // Calculate top position
        // Base top is textarea's top + padding + (line number * line height) - textarea's scrollTop
        const top = textareaRect.top + paddingTop + (currentLineNumber * actualLineHeight) - currentActiveElement.scrollTop + window.scrollY;

        // Calculate left position
        // Base left is textarea's left + padding + measured width of text before cursor - textarea's scrollLeft
        const left = textareaRect.left + paddingLeft + textWidthBeforeCursor - currentActiveElement.scrollLeft + window.scrollX;

        // Set ghost span styles
        ghostSpan.style.top = `${top}px`;
        ghostSpan.style.left = `${left}px`;
        // Constrain to textarea width, considering the starting 'left' position
        ghostSpan.style.maxWidth = `${textareaRect.width - (left - textareaRect.left) - paddingLeft}px`;
        ghostSpan.style.minWidth = '0px';
        ghostSpan.style.minHeight = '0px';
        ghostSpan.style.whiteSpace = "pre-wrap"; // Ensure line breaks are respected
        ghostSpan.style.wordBreak = "break-word";
        ghostSpan.style.fontFamily = textareaStyle.fontFamily;
        ghostSpan.style.fontSize = textareaStyle.fontSize;
        ghostSpan.style.lineHeight = textareaStyle.lineHeight;
        ghostSpan.style.padding = '0'; // No padding for ghost span itself
        ghostSpan.style.border = 'none'; // No border
        ghostSpan.style.background = 'transparent'; // Transparent background
        ghostSpan.style.pointerEvents = "none"; // Crucial so it doesn't interfere with clicks
        ghostSpan.style.opacity = "0.4";
        ghostSpan.style.color = "#999";
        ghostSpan.style.zIndex = "9999";
    }

    function acceptSuggestion() {
        if (!currentActiveElement || !fullCode) return;

        const originalScrollTop = currentActiveElement.scrollTop;
        const originalScrollLeft = currentActiveElement.scrollLeft;

        // Assuming fullCode contains the entire content including the prompt
        currentActiveElement.value = fullCode;
        currentActiveElement.selectionStart = currentActiveElement.selectionEnd = fullCode.length;

        currentActiveElement.scrollTop = originalScrollTop;
        currentActiveElement.scrollLeft = originalScrollLeft;

        hideSuggestion();
    }

    function onInput() {
        if (!currentActiveElement) {
            console.log("onInput: Aborting, currentActiveElement:", currentActiveElement);
            hideSuggestion();
            return;
        }

        if (debounceTimer) clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {
            if (!currentActiveElement) {
                console.log("onInput debounced: currentActiveElement is null, aborting fetch.");
                hideSuggestion();
                return;
            }

            const fullInput = currentActiveElement.tagName === "TEXTAREA" ? currentActiveElement.value : currentActiveElement.innerText;

            if (fullInput.trim() === "" || fullInput === lastPrompt) {
                console.log("onInput debounced: No change or empty input, hiding suggestion.");
                hideSuggestion();
                return;
            }

            lastPrompt = fullInput;
            console.log("Fetching suggestion for:", fullInput);
            fetchSuggestion(fullInput);
        }, 500);
    }

    async function fetchSuggestion(prompt) {
        if (!currentActiveElement) {
            console.error("fetchSuggestion: currentActiveElement is null at the start, cannot fetch.");
            hideSuggestion();
            return;
        }

        try {
            const res = await fetch("/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: prompt })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(`Server error: ${res.status} - ${errorData.error || res.statusText}`);
            }

            const { snippet, fullCode: full } = await res.json();
            console.log("Received suggestion - Snippet:", snippet, "FullCode:", full);

            if (!currentActiveElement) {
                console.warn("currentActiveElement became null after fetch, discarding suggestion.");
                hideSuggestion();
                return;
            }

            const currentInputContent = currentActiveElement.tagName === "TEXTAREA" ? currentActiveElement.value : currentActiveElement.innerText;
            if (currentInputContent === prompt) {
                if (snippet && full) {
                    fullCode = full;
                    currentSnippet = snippet; // Ensure currentSnippet is set here
                    showSuggestion(snippet);
                } else {
                    hideSuggestion();
                    console.log("No valid snippet or fullCode received, hiding suggestion.");
                }
            } else {
                console.log("Input changed during fetch, discarding old suggestion.");
                hideSuggestion();
            }
        } catch (err) {
            console.error("Error fetching suggestion:", err);
            hideSuggestion();
        }
    }

    function onKeyDown(e) {
        // This 'this' refers to the textarea element due to the event listener context
        const start = this.selectionStart;
        const end = this.selectionEnd;
        const value = this.value;

        if (!currentActiveElement) return; // Ensure currentActiveElement is set

        // Prioritize Copilot Tab acceptance
        if (e.key === "Tab") {
            e.preventDefault(); // Prevent default tab behavior (inserting tab char or moving focus)
            if (currentSnippet) {
                console.log("Tab pressed: Accepting Copilot suggestion.");
                acceptSuggestion();
            } else {
                console.log("Tab pressed: No Copilot suggestion, performing manual indentation.");
                // Manual indentation logic
                const indentation = ' '.repeat(TAB_SIZE);
                this.value = value.substring(0, start) + indentation + value.substring(end);
                this.selectionStart = this.selectionEnd = start + TAB_SIZE;
            }
            return; // Important: Exit after handling Tab
        }

        // Handle ArrowRight for Copilot acceptance (only if suggestion exists and cursor is at end)
        if (e.key === "ArrowRight" && currentSnippet) {
            const currentText = currentActiveElement.tagName === "TEXTAREA" ? currentActiveElement.value : currentActiveElement.innerText;
            let cursorPosition;
            if (currentActiveElement.selectionStart !== undefined) {
                cursorPosition = currentActiveElement.selectionStart;
            } else if (currentActiveElement.isContentEditable) {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const preCaretRange = range.cloneRange();
                    preCaretRange.selectNodeContents(currentActiveElement);
                    preCaretRange.setEnd(range.endContainer, range.endOffset);
                    cursorPosition = preCaretRange.toString().length;
                } else {
                    cursorPosition = currentText.length;
                }
            } else {
                cursorPosition = currentText.length;
            }

            if (cursorPosition === currentText.length) {
                e.preventDefault();
                console.log("ArrowRight pressed at end of line: Accepting Copilot suggestion.");
                acceptSuggestion();
            }
            return; // Exit after handling ArrowRight
        }

        // Handle Escape to hide suggestion
        if (e.key === "Escape") {
            console.log("Escape pressed: Hiding Copilot suggestion.");
            hideSuggestion();
            return; // Exit after handling Escape
        }

        // --- Editor Logic for Indentation and Auto-Closing Brackets (Non-Copilot specific keydowns) ---
        // Handle Shift + Tab for de-indentation
        if ((e.key === 'Tab' || e.keyCode === 9) && e.shiftKey) { // This check will only run if the first 'Tab' block above didn't return
            e.preventDefault();
            console.log("Shift+Tab pressed: De-indenting.");
            const lines = value.substring(0, start).split('\n');
            const currentLineIndex = lines.length - 1;
            const currentLineStart = start - lines[currentLineIndex].length;
            const line = value.substring(currentLineStart, end);

            let deIndentedValue = value;
            let newCursorPosition = start;

            if (start !== end) {
                const selectedText = value.substring(start, end);
                const selectedLines = selectedText.split('\n');
                const newSelectedLines = selectedLines.map(line => {
                    if (line.startsWith(' '.repeat(TAB_SIZE))) {
                        return line.substring(TAB_SIZE);
                    }
                    return line;
                });
                deIndentedValue = value.substring(0, start) + newSelectedLines.join('\n') + value.substring(end);
                newCursorPosition = start + (newSelectedLines.join('\n').length - selectedText.length);
            } else {
                if (line.startsWith(' '.repeat(TAB_SIZE))) {
                    deIndentedValue = value.substring(0, currentLineStart) + line.substring(TAB_SIZE) + value.substring(end);
                    newCursorPosition = start - TAB_SIZE;
                }
            }
            this.value = deIndentedValue;
            this.selectionStart = this.selectionEnd = newCursorPosition;
            return; // Exit after handling Shift+Tab
        }
        // Handle Enter key for auto-indentation (general code logic)
        else if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            console.log("Enter pressed: Auto-indenting.");

            const lines = value.substring(0, start).split('\n');
            const currentLine = lines[lines.length - 1];
            let leadingSpaces = getLeadingSpaces(currentLine);

            const trimmedCurrentLine = currentLine.trimEnd();
            const lastChar = trimmedCurrentLine.charAt(trimmedCurrentLine.length - 1);

            // --- NEW: HTML-specific indentation after '>' ---
            const textBeforeCursorOnLine = currentLine.substring(0, start - (value.lastIndexOf('\n', start - 1) + 1));
            if (lastChar === '>' && textBeforeCursorOnLine.trim().endsWith('>')) {
                 leadingSpaces += TAB_SIZE; // Increase indent if previous line ended with '>'
            } else if (lastChar === '{' || lastChar === '(' || lastChar === '[' || lastChar === ':') {
                leadingSpaces += TAB_SIZE;
            }
            // --- END NEW: HTML-specific indentation ---

            this.value = value.substring(0, start) + '\n' + ' '.repeat(leadingSpaces) + value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1 + leadingSpaces;
            return; // Exit after handling Enter
        }
        // Handle auto-de-indentation for closing braces/brackets/parentheses
        else if (e.key === '}' || e.key === ')' || e.key === ']') {
            if (start === end) {
                const lines = value.substring(0, start).split('\n');
                const currentLine = lines[lines.length - 1];
                const prevLine = lines[lines.length - 2] || '';

                const currentLineLeadingSpaces = getLeadingSpaces(currentLine);
                const prevLineLeadingSpaces = getLeadingSpaces(prevLine);

                const trimmedPrevLine = prevLine.trimEnd();
                const prevLastChar = trimmedPrevLine.charAt(trimmedPrevLine.length - 1);
                const shouldDeIndent = (currentLineLeadingSpaces > prevLineLeadingSpaces) &&
                                         !(prevLastChar === '{' || prevLastChar === '(' || prevLastChar === '[');

                if (shouldDeIndent) {
                    e.preventDefault();
                    console.log(`Typing ${e.key}: Auto-de-indenting.`);
                    const newLeadingSpaces = Math.max(0, currentLineLeadingSpaces - TAB_SIZE);
                    const deIndentedLine = ' '.repeat(newLeadingSpaces) + currentLine.trimStart();

                    this.value = value.substring(0, start - currentLine.length) + deIndentedLine + e.key + value.substring(end);
                    this.selectionStart = this.selectionEnd = start + 1 - (currentLineLeadingSpaces - newLeadingSpaces);
                }
            }
            return; // Exit after handling closing brackets
        }
        // Handle auto-closing brackets, parentheses, and braces
        else if (e.key === '(' || e.key === '{' || e.key === '[') {
            e.preventDefault();
            console.log(`Typing ${e.key}: Auto-closing counterpart.`);

            let closingChar = '';
            if (e.key === '(') closingChar = ')';
            else if (e.key === '{') closingChar = '}';
            else if (e.key === '[') closingChar = ']';

            this.value = value.substring(0, start) + e.key + closingChar + value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1;
            return; // Exit after handling opening brackets
        }
    }

    // Optional: Adjust height based on content (currently commented out)
    textarea.addEventListener('input', () => {
        // This is a simple auto-resize. For more robust solutions, consider a library or more complex logic.
        // textarea.style.height = 'auto';
        // textarea.style.height = (textarea.scrollHeight) + 'px';
    });

    // Initial setup for the textarea since it's present on load
    if (textarea) {
        currentActiveElement = textarea;
        setupElementListeners(textarea);
        onInput(); // Trigger initial suggestion if text exists
    }
});
