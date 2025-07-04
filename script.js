document.addEventListener('DOMContentLoaded', () => {
    const dropBtn = document.querySelector('.dropbtn');
    const menu = document.querySelector('.dropdown-menu');
    const textarea = document.getElementById('codeEditor');

    const mp = {
        "cpp": "cpp.txt",
        "c": "c.txt",
        "python": "python.txt",
        "java": "java.txt",
        "javascript": "javascript.txt",
        "html": "html.txt",
        "css": "css.txt"
    };

    const TAB_SIZE = 4;

    let currentActiveElement = null;
    let ghostSpan = null;
    let currentSnippet = "";
    let fullCode = "";
    let lastPrompt = "";
    let debounceTimer = null;
    let focusOutTimer = null;

    const getLeadingSpaces = (line) => {
        const match = line.match(/^\s*/);
        return match ? match[0].length : 0;
    };

    dropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });

    window.addEventListener('click', (e) => {
        if (!dropBtn.contains(e.target) && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

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
                let code = await res.text();
                textarea.value = code;
                onInput();
            } catch (err) {
                console.error("Error loading file:", err);
                textarea.value = `// Failed to load ${fileName}`;
            } finally {
                menu.style.display = 'none';
            }
        });
    });

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

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
        if (target.tagName === "TEXTAREA" || target.getAttribute("contenteditable") === "true") {
            if (currentActiveElement && currentActiveElement !== target) {
                hideSuggestion();
            }
            currentActiveElement = target;
            setupElementListeners(currentActiveElement);
            onInput();
        } else {
            if (currentActiveElement) {
                if (focusOutTimer) clearTimeout(focusOutTimer);
                focusOutTimer = setTimeout(() => {
                    if (document.activeElement !== currentActiveElement &&
                        (document.activeElement.tagName !== "TEXTAREA" && document.activeElement.getAttribute("contenteditable") !== "true")) {
                        hideSuggestion();
                        currentActiveElement = null;
                    }
                }, 50);
            }
        }
    }

    function handleFocusOut(event) {
        const relatedTarget = event.relatedTarget;

        if (focusOutTimer) clearTimeout(focusOutTimer);

        focusOutTimer = setTimeout(() => {
            const newActiveElement = document.activeElement;

            if (newActiveElement !== currentActiveElement &&
                newActiveElement !== ghostSpan &&
                (newActiveElement === null ||
                (newActiveElement.tagName !== "TEXTAREA" && newActiveElement.getAttribute("contenteditable") !== "true"))) {
                if (currentActiveElement) {
                    hideSuggestion();
                    currentActiveElement = null;
                }
            }
        }, 150);
    }

    function setupElementListeners(element) {
        element.removeEventListener("input", onInput);
        element.removeEventListener("keydown", onKeyDown);

        element.addEventListener("input", onInput);
        element.addEventListener("keydown", onKeyDown);

        if (!ghostSpan) {
            ghostSpan = document.createElement('span');
            ghostSpan.className = 'ghost-suggestion';
            document.body.appendChild(ghostSpan);
        }
    }

    function showSuggestion(snippet) {
        if (!currentActiveElement || !ghostSpan || !snippet) {
            hideSuggestion();
            return;
        }
        currentSnippet = snippet;
        ghostSpan.textContent = snippet;
        ghostSpan.style.display = "block";
        positionGhostSpan();
    }

    function hideSuggestion() {
        if (ghostSpan) {
            ghostSpan.style.display = "none";
            ghostSpan.textContent = "";
        }
        currentSnippet = "";
        fullCode = "";
        lastPrompt = "";
        if (debounceTimer) clearTimeout(debounceTimer);
    }

    function positionGhostSpan() {
        if (!currentActiveElement || !ghostSpan) return;

        const textareaRect = currentActiveElement.getBoundingClientRect();
        const textareaStyle = window.getComputedStyle(currentActiveElement);

        const paddingLeft = parseFloat(textareaStyle.paddingLeft);
        const paddingTop = parseFloat(textareaStyle.paddingTop);
        const fontSize = parseFloat(textareaStyle.fontSize);
        const lineHeight = parseFloat(textareaStyle.lineHeight);
        const actualLineHeight = lineHeight > 0 && !isNaN(lineHeight) ? lineHeight : fontSize * 1.2;

        let cursorCoords;

        // For TEXTAREA elements, we can often rely on a simpler approach
        // if direct DOM manipulation for cursor is not feasible/reliable.
        // The common approach for textarea is to use a mirror div.
        // However, if the mirror div is problematic, we can try to get
        // the rect of a temporary range for contenteditable, or
        // fallback to approximate for textarea.

        // Let's use the mirror div with careful attention to scroll.
        const tempMeasurer = document.createElement('div');
        tempMeasurer.style.position = 'absolute';
        tempMeasurer.style.visibility = 'hidden';
        tempMeasurer.style.pointerEvents = 'none'; // Ensure it doesn't interfere with interaction
        tempMeasurer.style.fontFamily = textareaStyle.fontFamily;
        tempMeasurer.style.fontSize = textareaStyle.fontSize;
        tempMeasurer.style.lineHeight = textareaStyle.lineHeight;
        tempMeasurer.style.whiteSpace = 'pre-wrap'; // Important for matching line breaks/wrapping
        tempMeasurer.style.wordBreak = 'break-word'; // Important for matching word breaking
        tempMeasurer.style.tabSize = textareaStyle.tabSize;
        tempMeasurer.style.MozTabSize = textareaStyle.MozTabSize;
        tempMeasurer.style.width = textareaRect.width - paddingLeft - parseFloat(textareaStyle.paddingRight) + 'px'; // Match content width
        tempMeasurer.style.padding = '0';
        tempMeasurer.style.border = '0';
        tempMeasurer.style.boxSizing = textareaStyle.boxSizing; // Crucial

        // To calculate accurate horizontal position for the cursor,
        // we append the text up to the cursor and measure its width.
        const textBeforeCursor = currentActiveElement.value.substring(0, currentActiveElement.selectionStart);
        const lines = textBeforeCursor.split('\n');
        const currentLineText = lines[lines.length - 1];

        // This span will help measure the width of the text on the current line
        const widthMeasurer = document.createElement('span');
        widthMeasurer.textContent = currentLineText;
        tempMeasurer.appendChild(widthMeasurer);

        // This span will push the height to the correct line
        const heightMeasurer = document.createElement('span');
        heightMeasurer.innerHTML = textBeforeCursor.replace(/\n/g, '<br>') + '&#x200b;'; // Use <br> for newlines, add zero-width space
        tempMeasurer.appendChild(heightMeasurer);

        document.body.appendChild(tempMeasurer);

        const cursorX = widthMeasurer.offsetWidth; // Width of text on current line
        const cursorY = heightMeasurer.offsetHeight; // Total height of content up to cursor, including current line

        document.body.removeChild(tempMeasurer);

        // Adjust for textarea's scroll position
        const adjustedX = cursorX - currentActiveElement.scrollLeft;
        const adjustedY = cursorY - currentActiveElement.scrollTop;

        // Calculate final screen coordinates relative to the viewport
        // Use textareaRect for its absolute position
        const finalLeft = textareaRect.left + paddingLeft + adjustedX + window.scrollX;
        const finalTop = textareaRect.top + paddingTop + adjustedY + window.scrollY - actualLineHeight; // Subtract line height to get to top of line

        ghostSpan.style.top = `${finalTop}px`;
        ghostSpan.style.left = `${finalLeft}px`;
        ghostSpan.style.maxWidth = `${textareaRect.width - (finalLeft - textareaRect.left) - paddingLeft}px`;
        ghostSpan.style.minWidth = '0px';
        ghostSpan.style.minHeight = '0px';
        ghostSpan.style.whiteSpace = "pre-wrap";
        ghostSpan.style.wordBreak = "break-word";
        ghostSpan.style.fontFamily = textareaStyle.fontFamily;
        ghostSpan.style.fontSize = textareaStyle.fontSize;
        ghostSpan.style.lineHeight = textareaStyle.lineHeight;
        ghostSpan.style.padding = '0';
        ghostSpan.style.border = 'none';
        ghostSpan.style.background = 'transparent';
        ghostSpan.style.pointerEvents = "none";
        ghostSpan.style.opacity = "0.4";
        ghostSpan.style.color = "#999";
        ghostSpan.style.zIndex = "9999";
    }

    function onInput() {
        if (!currentActiveElement) {
            hideSuggestion();
            return;
        }

        if (debounceTimer) clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {
            if (!currentActiveElement) {
                hideSuggestion();
                return;
            }

            const fullInput = currentActiveElement.value;

            if (fullInput.trim() === "" || fullInput === lastPrompt) {
                hideSuggestion();
                return;
            }

            lastPrompt = fullInput;
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
            const selectedLanguage = dropBtn.textContent;

            const res = await fetch("/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: prompt, lang: selectedLanguage })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(`Server error: ${res.status} - ${errorData.error || res.statusText}`);
            }

            const { snippet, fullCode: full } = await res.json();

            if (!currentActiveElement) {
                console.warn("currentActiveElement became null after fetch, discarding suggestion.");
                hideSuggestion();
                return;
            }

            const currentInputContent = currentActiveElement.value;
            if (currentInputContent === prompt) {
                if (snippet && full) {
                    fullCode = full;
                    showSuggestion(snippet);
                } else {
                    hideSuggestion();
                }
            } else {
                hideSuggestion();
            }
        } catch (err) {
            console.error("Error fetching suggestion:", err);
            hideSuggestion();
        }
    }

    function onKeyDown(e) {
        const start = this.selectionStart;
        const end = this.selectionEnd;
        const value = this.value;

        if (!currentActiveElement) return;

        if (e.key === "Tab") {
            e.preventDefault();

            if (e.shiftKey) {
                const lines = value.substring(0, start).split('\n');
                const currentLineIndex = lines.length - 1;
                const currentLineStart = start - lines[currentLineIndex].length;
                const line = value.substring(currentLineStart, start);

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
                    newCursorPosition = start;
                    for (let i = 0; i < selectedLines.length; i++) {
                        if (selectedLines[i].startsWith(' '.repeat(TAB_SIZE))) {
                            newCursorPosition -= TAB_SIZE;
                        }
                    }
                    newCursorPosition = Math.max(start - (selectedText.length - newSelectedLines.join('\n').length), 0);
                } else {
                    if (line.startsWith(' '.repeat(TAB_SIZE))) {
                        deIndentedValue = value.substring(0, currentLineStart) + line.substring(TAB_SIZE) + value.substring(start);
                        newCursorPosition = start - TAB_SIZE;
                    }
                }
                this.value = deIndentedValue;
                this.selectionStart = this.selectionEnd = newCursorPosition;

            } else if (currentSnippet && fullCode) {
                const originalScrollTop = this.scrollTop;
                const originalScrollLeft = this.scrollLeft;

                this.value = fullCode;
                this.selectionStart = this.selectionEnd = fullCode.length;

                this.scrollTop = originalScrollTop;
                this.scrollLeft = originalScrollLeft;

                hideSuggestion();
            } else {
                const indentation = ' '.repeat(TAB_SIZE);
                this.value = value.substring(0, start) + indentation + value.substring(end);
                this.selectionStart = this.selectionEnd = start + TAB_SIZE;
            }
            return;
        }

        if (e.key === "ArrowRight" && currentSnippet) {
            const currentText = currentActiveElement.value;
            const cursorPosition = currentActiveElement.selectionStart;

            if (cursorPosition === currentText.length) {
                e.preventDefault();
                const originalScrollTop = this.scrollTop;
                const originalScrollLeft = this.scrollLeft;

                this.value = fullCode;
                this.selectionStart = this.selectionEnd = fullCode.length;

                this.scrollTop = originalScrollTop;
                this.scrollLeft = originalScrollLeft;

                hideSuggestion();
            }
            return;
        }

        if (e.key === "Escape") {
            hideSuggestion();
            return;
        }

        else if (e.key === 'Enter') {
            e.preventDefault();

            const lines = value.substring(0, start).split('\n');
            const currentLine = lines[lines.length - 1];
            let leadingSpaces = getLeadingSpaces(currentLine);

            const trimmedCurrentLine = currentLine.trimEnd();
            const lastChar = trimmedCurrentLine.charAt(trimmedCurrentLine.length - 1);

            const textBeforeCursorOnLine = currentLine.substring(0, start - (value.lastIndexOf('\n', start - 1) + 1));
            if (lastChar === '>' && textBeforeCursorOnLine.trim().endsWith('>')) {
                leadingSpaces += TAB_SIZE;
            } else if (lastChar === '{' || lastChar === '(' || lastChar === '[' || lastChar === ':') {
                leadingSpaces += TAB_SIZE;
            }

            this.value = value.substring(0, start) + '\n' + ' '.repeat(leadingSpaces) + value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1 + leadingSpaces;
            return;
        }
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
                    const newLeadingSpaces = Math.max(0, currentLineLeadingSpaces - TAB_SIZE);
                    const deIndentedLine = ' '.repeat(newLeadingSpaces) + currentLine.trimStart();

                    this.value = value.substring(0, start - currentLine.length) + deIndentedLine + e.key + value.substring(end);
                    this.selectionStart = this.selectionEnd = start + 1 - (currentLineLeadingSpaces - newLeadingSpaces);
                }
            }
            return;
        }
        else if (e.key === '(' || e.key === '{' || e.key === '[') {
            e.preventDefault();

            let closingChar = '';
            if (e.key === '(') closingChar = ')';
            else if (e.key === '{') closingChar = '}';
            else if (e.key === '[') closingChar = ']';

            this.value = value.substring(0, start) + e.key + closingChar + value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1;
            return;
        }
    }

    if (textarea) {
        currentActiveElement = textarea;
        setupElementListeners(textarea);
    }
});
