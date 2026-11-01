const $ = id => document.getElementById(id);
const STORAGE_KEY = "studynova_notes";
const RESEARCH_API_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  window.location.port === "8000"
  ? "/api/research"
  : "http://127.0.0.1:8000/api/research";
const pageTitles = {
  dashboard: "Learn smarter. Go further.",
  notes: "Your study library",
  quiz: "Practice questions",
  voice: "Listen and learn"
};

let currentNotes = "";
let currentPhotos = [];
let savedNotes = loadSavedNotes();
let quizQuestions = [];
let showingAnswers = false;
let ocrLibraryPromise;

function loadSavedNotes() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const notes = JSON.parse(stored);
    if (!Array.isArray(notes)) throw new Error("Saved notes are not a list.");
    return notes.filter(note =>
      note && typeof note.title === "string" &&
      typeof note.content === "string" &&
      typeof note.date === "string" &&
      (!note.photos || (Array.isArray(note.photos) && note.photos.every(photo =>
        photo && typeof photo.name === "string" &&
        typeof photo.dataUrl === "string" &&
        photo.dataUrl.startsWith("data:image/")
      )))
    );
  } catch (error) {
    console.error("Could not load saved notes.", error);
    $("mainStatus").textContent = "Saved notes could not be loaded. They may be damaged or unavailable.";
    return [];
  }
}

function showView(name) {
  if (!pageTitles[name]) return;
  ["dashboard", "notes", "quiz", "voice"].forEach(view => {
    $(view + "View").classList.toggle("hidden", view !== name);
  });
  document.querySelectorAll(".nav-link").forEach(button => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  $("pageHeading").textContent = pageTitles[name];
}

document.querySelectorAll(".nav-link").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.go));
});
document.querySelector(".brand").addEventListener("click", event => {
  event.preventDefault();
  showView("dashboard");
});

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(sentence => sentence.trim()).filter(Boolean) || [];
}

function displayNotes(content, photos = currentPhotos) {
  currentNotes = content;
  currentPhotos = photos;
  const output = $("notesOutput");
  output.textContent = content;
  output.classList.toggle("empty-state", !content);
  output.style.whiteSpace = "pre-wrap";
  renderPhotoGallery($("notesPhotos"), currentPhotos);
}

function renderPhotoGallery(container, photos, removable = false) {
  container.replaceChildren();
  photos.forEach((photo, index) => {
    const figure = document.createElement("figure");
    figure.className = "photo-item";
    const image = document.createElement("img");
    image.src = photo.dataUrl;
    image.alt = photo.name;
    image.loading = "lazy";
    const caption = document.createElement("figcaption");
    caption.textContent = photo.name;
    figure.append(image, caption);
    if (removable) {
      const removeButton = makeButton("Remove", "button button-small button-quiet", () => {
        currentPhotos.splice(index, 1);
        renderPhotoGallery(container, currentPhotos, true);
        renderPhotoGallery($("notesPhotos"), currentPhotos);
      });
      removeButton.setAttribute("aria-label", `Remove photo ${photo.name}`);
      figure.appendChild(removeButton);
    }
    container.appendChild(figure);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} is larger than 12 MB.`);
  const imageData = await readFileAsDataUrl(file);
  const image = new Image();
  image.src = imageData;
  try {
    await image.decode();
  } catch (error) {
    throw new Error(`Could not open ${file.name}.`);
  }
  const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photo resizing is unavailable in this browser.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    name: file.name,
    dataUrl: canvas.toDataURL("image/jpeg", 0.8)
  };
}

async function addPhotos(event) {
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length) return;
  const availableSlots = 5 - currentPhotos.length;
  if (availableSlots <= 0) {
    $("mainStatus").textContent = "You can attach up to 5 photos to a note.";
    return;
  }
  const acceptedFiles = files.slice(0, availableSlots);
  const errors = [];
  for (const file of acceptedFiles) {
    try {
      currentPhotos.push(await preparePhoto(file));
    } catch (error) {
      console.error("Could not add photo.", error);
      errors.push(error.message);
    }
  }
  renderPhotoGallery($("photoPreview"), currentPhotos, true);
  renderPhotoGallery($("notesPhotos"), currentPhotos);
  if (errors.length) {
    $("mainStatus").textContent = errors.join(" ");
  } else if (files.length > acceptedFiles.length) {
    $("mainStatus").textContent = "Added 5 photos. You can attach up to 5 photos to a note.";
  } else {
    $("mainStatus").textContent = `${acceptedFiles.length} photo${acceptedFiles.length === 1 ? "" : "s"} added to your notes.`;
  }
}

function loadOcrLibrary() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (ocrLibraryPromise) return ocrLibraryPromise;
  ocrLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("The OCR engine loaded but could not be started."));
    };
    script.onerror = () => reject(new Error("Could not download the OCR engine. Check your internet connection and try again."));
    document.head.appendChild(script);
  }).catch(error => {
    ocrLibraryPromise = null;
    throw error;
  });
  return ocrLibraryPromise;
}

async function readPhotoText() {
  if (!currentPhotos.length) {
    $("mainStatus").textContent = "Add at least one photo before reading text.";
    return;
  }
  const language = $("studyLanguage").value;
  let worker;
  try {
    $("mainStatus").textContent = "Loading the photo text reader. Your photos are processed in this browser.";
    const tesseract = await loadOcrLibrary();
    worker = await tesseract.createWorker(language, 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: message => {
        if (message.status === "recognizing text") {
          $("mainStatus").textContent = `Reading text from photos (${Math.round(message.progress * 100)}%)...`;
        } else if (message.status === "loading language traineddata") {
          $("mainStatus").textContent = "Downloading the selected OCR language data...";
        }
      }
    });
    const extractedText = [];
    for (const photo of currentPhotos) {
      const result = await worker.recognize(photo.dataUrl);
      if (result.data.text.trim()) extractedText.push(result.data.text.trim());
    }
    if (!extractedText.length) {
      $("mainStatus").textContent = "No readable text was found in the selected photos.";
      return;
    }
    const existingText = $("sourceText").value.trim();
    $("sourceText").value = [existingText, ...extractedText].filter(Boolean).join("\n\n");
    makeLocalStudyNotes();
  } catch (error) {
    console.error("Could not recognize text in photos.", error);
    $("mainStatus").textContent = error.message || "Could not read text from the photos.";
  } finally {
    if (worker) await worker.terminate();
  }
}

function makeBasicNotes() {
  const source = $("sourceText").value.trim();
  if (!source) {
    $("mainStatus").textContent = "Add some notes or a topic first.";
    return;
  }

  const points = splitSentences(source);
  displayNotes(
    "STUDY NOTES\n\nKEY POINTS\n" +
    points.map((point, index) => `${index + 1}. ${point}`).join("\n\n") +
    "\n\nREVISION TIP\nExplain each key point in your own words."
  );
  $("sourcesOutput").replaceChildren();
  $("mainStatus").textContent = "Basic notes created locally from your text.";
}

function makeLocalStudyNotes() {
  const source = $("sourceText").value.trim();
  if (!source) {
    $("mainStatus").textContent = "Add some notes or a topic first.";
    return;
  }

  const points = splitSentences(source);
  const overview = points.length > 1
    ? points.slice(0, 2).join(" ")
    : `Study topic: ${source}`;
  const reviewPrompts = points.slice(0, 3).map((point, index) =>
    `${index + 1}. Explain this point in your own words: ${point}`
  );
  const content = [
    "STUDY NOTES",
    "",
    "OVERVIEW",
    overview,
    "",
    "KEY POINTS",
    points.map((point, index) => `${index + 1}. ${point}`).join("\n\n"),
    "",
    "REVIEW PROMPTS",
    reviewPrompts.join("\n\n"),
    "",
    "REVISION TIP",
    "Cover the key points and try to recall them before checking your notes."
  ].join("\n");

  displayNotes(content);
  $("sourcesOutput").replaceChildren();
  $("mainStatus").textContent = "Notes organized locally from your text. No backend or external research was used.";
}

async function researchWithOpenAI() {
  const query = $("sourceText").value.trim();
  const button = $("openaiResearchBtn");

  if (!query) {
    $("mainStatus").textContent = "Enter a topic or notes to research with AI.";
    return;
  }

  button.disabled = true;
  $("mainStatus").textContent = "Researching your topic with OpenAI...";
  try {
    const languages = {
      eng: "English",
      sqi: "Albanian",
      deu: "German",
      fra: "French",
      spa: "Spanish"
    };
    const response = await fetch(RESEARCH_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: query,
        level: $("studyLevel").value,
        language: languages[$("studyLanguage").value] || "English"
      })
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (response.status === 404 || response.status === 405) {
        throw new Error(
          `This page is using a static server (HTTP ${response.status}), which cannot run AI research. Start StudyNova with "py .\\server.py" and open http://127.0.0.1:8000.`
        );
      }
      throw new Error("The research server returned an unreadable response. Check that the local server is running.");
    }
    if (!response.ok) {
      throw new Error(data.error || `OpenAI research failed (HTTP ${response.status}).`);
    }

    if (typeof data.notes !== "string" || !data.notes.trim()) {
      throw new Error("OpenAI returned no notes. Try a more specific topic.");
    }

    const sources = (data.sources || []).filter(source => {
      if (typeof source.title !== "string" || typeof source.url !== "string") return false;
      try {
        return ["https:", "http:"].includes(new URL(source.url).protocol);
      } catch (error) {
        return false;
      }
    }).slice(0, 10);

    displayNotes(data.notes);
    const sourcesOutput = $("sourcesOutput");
    sourcesOutput.replaceChildren();
    if (sources.length) {
      const heading = document.createElement("h3");
      heading.textContent = "Research sources";
      sourcesOutput.appendChild(heading);
    }
    sources.forEach((source, index) => {
      const link = document.createElement("a");
      link.className = "source-link";
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${index + 1}. ${source.title} (${new URL(source.url).hostname})`;
      sourcesOutput.appendChild(link);
    });
    $("mainStatus").textContent = sources.length
      ? `Created AI study notes with ${sources.length} web source${sources.length === 1 ? "" : "s"}.`
      : "Created AI study notes. OpenAI did not return web citations for this topic.";
  } catch (error) {
    console.error("OpenAI research failed.", error);
    $("mainStatus").textContent = error instanceof TypeError
      ? "Cannot connect to the research server. Start it with \"py .\\server.py\" and open StudyNova at http://127.0.0.1:8000 (or keep using your local preview)."
      : error.message || "OpenAI research failed. Check the local server and try again.";
  } finally {
    button.disabled = false;
  }
}

function generateQuestions() {
  const source = $("sourceText").value.trim() || currentNotes;
  const points = [...new Set(splitSentences(source))].slice(0, 5);
  if (!points.length) {
    $("mainStatus").textContent = "Add notes or create basic notes before generating questions.";
    showView("dashboard");
    return;
  }

  quizQuestions = points.map((answer, index) => {
    const distractors = points.filter((_, pointIndex) => pointIndex !== index).slice(0, 3);
    const options = points.length === 1
      ? ["True", "False"]
      : [answer, ...distractors];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { prompt: points.length === 1 ? `Is this statement in your notes: “${answer}”` : "Which statement appears in your notes?", answer: points.length === 1 ? "True" : answer, options };
  });
  showingAnswers = false;
  renderQuiz();
  $("quizStatus").textContent = "Choose an answer for each question. Your score updates as you answer.";
  showView("quiz");
}

function renderQuiz() {
  const output = $("quizOutput");
  output.replaceChildren();

  quizQuestions.forEach((question, questionIndex) => {
    const card = document.createElement("section");
    card.className = "quiz-card";
    const prompt = document.createElement("div");
    prompt.className = "quiz-question";
    prompt.textContent = `${questionIndex + 1}. ${question.prompt}`;
    card.appendChild(prompt);

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "quiz-option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `question-${questionIndex}`;
      radio.value = option;
      radio.checked = question.selected === option;
      radio.addEventListener("change", () => {
        question.selected = option;
        renderQuiz();
        updateQuizStatus();
      });
      label.append(radio, document.createTextNode(option));
      if (showingAnswers) {
        if (option === question.answer) label.classList.add("correct");
        else if (option === question.selected) label.classList.add("incorrect");
      } else if (question.selected === option) {
        label.classList.add(option === question.answer ? "correct" : "incorrect");
      }
      card.appendChild(label);
    });

    if (question.selected) {
      const feedback = document.createElement("p");
      feedback.className = "quiz-feedback";
      feedback.textContent = question.selected === question.answer
        ? "Correct."
        : `Not quite. The answer is: ${question.answer}`;
      card.appendChild(feedback);
    } else if (showingAnswers) {
      const answer = document.createElement("p");
      answer.className = "quiz-feedback";
      answer.textContent = `Answer: ${question.answer}`;
      card.appendChild(answer);
    }
    output.appendChild(card);
  });

  const answered = quizQuestions.filter(question => question.selected).length;
  if (answered) {
    const score = document.createElement("div");
    score.className = "score-box";
    const correct = quizQuestions.filter(question => question.selected === question.answer).length;
    score.textContent = `Score: ${correct} / ${answered} answered`;
    output.appendChild(score);
  }
}

function updateQuizStatus() {
  const answered = quizQuestions.filter(question => question.selected).length;
  if (answered === quizQuestions.length) {
    const correct = quizQuestions.filter(question => question.selected === question.answer).length;
    $("quizStatus").textContent = `Quiz complete — you got ${correct} out of ${quizQuestions.length} correct.`;
  } else {
    $("quizStatus").textContent = `Answered ${answered} of ${quizQuestions.length}.`;
  }
}

function showAllAnswers() {
  if (!quizQuestions.length) {
    $("quizStatus").textContent = "Generate a quiz first.";
    return;
  }
  showingAnswers = !showingAnswers;
  renderQuiz();
}

function renderSavedNotes() {
  const container = $("savedNotes");
  container.replaceChildren();
  if (!savedNotes.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No saved notes yet. Create some notes on the dashboard and save them here.";
    container.appendChild(empty);
    return;
  }

  savedNotes.forEach((note, index) => {
    const card = document.createElement("article");
    card.className = "saved-note";
    const header = document.createElement("div");
    header.className = "saved-note-head";
    const titleGroup = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = note.title;
    const date = document.createElement("p");
    date.className = "muted";
    date.textContent = note.date;
    titleGroup.append(title, date);

    const actions = document.createElement("div");
    actions.className = "note-actions";
    const openButton = makeButton("Open", "button button-small button-secondary", () => {
      displayNotes(note.content, note.photos || []);
      $("sourceText").value = note.content;
      renderPhotoGallery($("photoPreview"), currentPhotos, true);
      showView("dashboard");
    });
    const deleteButton = makeButton("Delete", "button button-small button-quiet", () => {
      const deletedNote = savedNotes[index];
      savedNotes.splice(index, 1);
      if (!persistNotes()) savedNotes.splice(index, 0, deletedNote);
      renderSavedNotes();
    });
    actions.append(openButton, deleteButton);
    header.append(titleGroup, actions);

    const preview = document.createElement("p");
    preview.textContent = note.content;
    card.append(header, preview);
    if (note.photos && note.photos.length) {
      const photos = document.createElement("div");
      photos.className = "photo-gallery saved-photo-gallery";
      renderPhotoGallery(photos, note.photos);
      card.appendChild(photos);
    }
    container.appendChild(card);
  });
}

function makeButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function persistNotes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedNotes));
  } catch (error) {
    console.error("Could not save notes to local storage.", error);
    $("mainStatus").textContent = "Notes could not be saved on this device. Check browser storage settings.";
    return false;
  }
  renderSavedNotes();
  return true;
}

function saveCurrentNotes() {
  if (!currentNotes.trim()) {
    $("mainStatus").textContent = "Create notes before saving.";
    return;
  }
  saveNoteToLibrary(currentNotes, $("sourceText").value);
}

function saveTextAsIs() {
  const text = $("sourceText").value;
  if (!text.trim()) {
    $("mainStatus").textContent = "Enter some text before saving it.";
    return;
  }
  saveNoteToLibrary(text, text);
}

function saveNoteToLibrary(content, titleSource) {
  const firstLine = titleSource.split(/\r?\n/).find(line => line.trim())?.trim();
  const title = firstLine && !/^STUDY NOTES$/i.test(firstLine)
    ? firstLine.slice(0, 60)
    : "My study notes";
  savedNotes.unshift({
    title,
    content,
    date: new Date().toLocaleDateString(),
    photos: currentPhotos
  });
  if (!persistNotes()) {
    savedNotes.shift();
    return;
  }
  $("mainStatus").textContent = "Note saved to My notes in this browser.";
  showView("notes");
}

async function copyCurrentNotes() {
  if (!currentNotes.trim()) {
    $("mainStatus").textContent = "Create notes before copying.";
    return;
  }
  if (!navigator.clipboard) {
    $("mainStatus").textContent = "Clipboard access is unavailable. Copy the notes manually.";
    return;
  }
  try {
    await navigator.clipboard.writeText(currentNotes);
    $("mainStatus").textContent = "Notes copied to clipboard.";
  } catch (error) {
    console.error("Could not copy notes to the clipboard.", error);
    $("mainStatus").textContent = "Could not access the clipboard. Copy the notes manually.";
  }
}

function loadVoices() {
  if (!("speechSynthesis" in window)) {
    $("voiceStatus").textContent = "Speech synthesis is not supported in this browser.";
    return;
  }
  const select = $("voiceSelect");
  const selectedVoice = select.value;
  const voices = window.speechSynthesis.getVoices();
  select.replaceChildren(new Option("Default browser voice", ""));
  voices.forEach((voice, index) => {
    select.add(new Option(`${voice.name} (${voice.lang})`, String(index)));
  });
  if (selectedVoice && voices[Number(selectedVoice)]) select.value = selectedVoice;
}

function playVoice() {
  if (!("speechSynthesis" in window)) {
    $("voiceStatus").textContent = "Speech synthesis is not supported in this browser.";
    return;
  }
  const text = $("voiceText").value.trim();
  if (!text) {
    $("voiceStatus").textContent = "Enter text or use your notes before playing.";
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const selectedVoice = voices[Number($("voiceSelect").value)];
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.rate = Number($("voiceSpeed").value);
  utterance.onstart = () => $("voiceStatus").textContent = "Playing your notes...";
  utterance.onend = () => $("voiceStatus").textContent = "Playback finished.";
  utterance.onerror = event => {
    console.error("Speech playback failed.", event.error);
    $("voiceStatus").textContent = "Could not play this voice.";
  };
  window.speechSynthesis.speak(utterance);
}

$("makeSimpleNotesBtn").addEventListener("click", makeBasicNotes);
$("researchBtn").addEventListener("click", makeLocalStudyNotes);
$("openaiResearchBtn").addEventListener("click", researchWithOpenAI);
$("makeQuestionsBtn").addEventListener("click", generateQuestions);
$("quizFromCurrentBtn").addEventListener("click", generateQuestions);
$("showAnswersBtn").addEventListener("click", showAllAnswers);
$("saveNotesBtn").addEventListener("click", saveCurrentNotes);
$("saveTextAsIsBtn").addEventListener("click", saveTextAsIs);
$("photoInput").addEventListener("change", addPhotos);
$("readPhotoTextBtn").addEventListener("click", readPhotoText);
$("copyNotesBtn").addEventListener("click", copyCurrentNotes);
$("readNotesBtn").addEventListener("click", () => {
  if (!currentNotes.trim()) {
    $("mainStatus").textContent = "Create notes before listening.";
    return;
  }
  $("voiceText").value = currentNotes;
  showView("voice");
  playVoice();
});
$("playVoiceBtn").addEventListener("click", playVoice);
$("pauseVoiceBtn").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    $("voiceStatus").textContent = "Speech synthesis is not supported in this browser.";
    return;
  }
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  else if (window.speechSynthesis.speaking) window.speechSynthesis.pause();
});
$("stopVoiceBtn").addEventListener("click", () => {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  $("voiceStatus").textContent = "Playback stopped.";
});
$("useNotesVoiceBtn").addEventListener("click", () => {
  const text = currentNotes || $("sourceText").value.trim();
  if (!text) {
    $("voiceStatus").textContent = "Create or enter notes first.";
    return;
  }
  $("voiceText").value = text;
  $("voiceStatus").textContent = "Your notes are ready to play.";
});

renderSavedNotes();
loadVoices();
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
}
