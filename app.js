/**
 * VibeCBT - Core Application Logic
 * Author: Antigravity
 */

(() => {
  'use strict';

  // --- App State ---
  const state = {
    allQuestions: [],
    loaded: false,
    
    // Active session
    mode: 'practice', // 'practice' | 'exam' | 'wrong' | 'exam-fixed'
    activeQuestions: [],
    currentIndex: 0,
    userAnswers: {}, // { [questionKey]: selectedAnswer (1..4) }
    checkedQuestions: {}, // { [questionKey]: boolean }
    
    // Exam specific
    examTimerInterval: null,
    examTimeRemaining: 0, // seconds
    examTotalTime: 0,
    examSubmitted: false,
    
    // Persistent Data (from localStorage)
    wrongNotes: {}, // { [questionKey]: questionObject }
    bookmarks: {}, // { [questionKey]: questionObject }
    userMemos: {}, // { [questionKey]: string (user note) }
    stats: {
      totalSolved: 0,
      totalCorrect: 0,
      examsCompleted: 0
    },
    
    // Filter settings for practice setup
    filter: {
      selectedSubjects: [],
      selectedYears: [],
      questionCount: 20
    },
    
    theme: localStorage.getItem('vibecbt_theme') || 'dark'
  };

  // Helper to generate a unique key for a question
  function getQKey(q) {
    return `${q.examDate}_${q.id}`;
  }

  // --- Storage Manager ---
  const Storage = {
    load() {
      try {
        const savedWrong = localStorage.getItem('vibecbt_wrong_notes');
        if (savedWrong) state.wrongNotes = JSON.parse(savedWrong);
        
        const savedBookmarks = localStorage.getItem('vibecbt_bookmarks');
        if (savedBookmarks) state.bookmarks = JSON.parse(savedBookmarks);
        
        const savedMemos = localStorage.getItem('vibecbt_user_memos');
        if (savedMemos) state.userMemos = JSON.parse(savedMemos);

        const savedStats = localStorage.getItem('vibecbt_stats');
        if (savedStats) state.stats = JSON.parse(savedStats);
      } catch (e) {
        console.error('Failed to load local storage:', e);
      }
    },
    saveWrongNotes() {
      localStorage.setItem('vibecbt_wrong_notes', JSON.stringify(state.wrongNotes));
      UI.updateBadgeCounts();
    },
    saveBookmarks() {
      localStorage.setItem('vibecbt_bookmarks', JSON.stringify(state.bookmarks));
      UI.updateBadgeCounts();
    },
    saveUserMemos() {
      localStorage.setItem('vibecbt_user_memos', JSON.stringify(state.userMemos));
    },
    saveStats() {
      localStorage.setItem('vibecbt_stats', JSON.stringify(state.stats));
      UI.renderDashboardStats();
    },
    exportData() {
      const backup = {
        version: '1.0',
        date: new Date().toISOString(),
        wrongNotes: state.wrongNotes,
        bookmarks: state.bookmarks,
        userMemos: state.userMemos,
        stats: state.stats
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `VibeCBT_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    importData(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (imported.wrongNotes) state.wrongNotes = imported.wrongNotes;
          if (imported.bookmarks) state.bookmarks = imported.bookmarks;
          if (imported.userMemos) state.userMemos = imported.userMemos;
          if (imported.stats) state.stats = imported.stats;
          Storage.saveWrongNotes();
          Storage.saveBookmarks();
          Storage.saveUserMemos();
          Storage.saveStats();
          alert('데이터를 성공적으로 복원했습니다!');
        } catch (err) {
          alert('유효하지 않은 백업 파일입니다.');
        }
      };
      reader.readAsText(file);
    }
  };

  // --- UI Controller ---
  const UI = {
    init() {
      // Apply theme
      document.documentElement.setAttribute('data-theme', state.theme);
      
      // Setup event listeners
      this.bindEvents();
      this.updateBadgeCounts();
    },

    bindEvents() {
      // Theme Toggle
      document.getElementById('themeToggleBtn').addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', state.theme);
        localStorage.setItem('vibecbt_theme', state.theme);
      });

      // Navigation clicks
      document.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', (e) => {
          const target = el.getAttribute('data-nav');
          UI.switchView(target);
        });
      });

      // Mobile Bottom Nav
      document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-nav');
          UI.switchView(target);
          document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      // Keyboard shortcuts for solving
      window.addEventListener('keydown', (e) => {
        const quizView = document.getElementById('viewQuiz');
        if (!quizView.classList.contains('active')) return;
        
        // Prevent shortcut if inside input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key >= '1' && e.key <= '4') {
          UI.handleSelectOption(parseInt(e.key, 10));
        } else if (e.key === 'ArrowLeft') {
          UI.navigateQuestion(-1);
        } else if (e.key === 'ArrowRight' || e.key === ' ') {
          UI.navigateQuestion(1);
        } else if (e.key === 'Enter') {
          UI.toggleCheckAnswer();
        } else if (e.key === 'b' || e.key === 'B') {
          UI.toggleBookmark();
        }
      });

      // Mobile OMR sheet toggle
      const omrToggle = document.getElementById('omrMobileToggle');
      if (omrToggle) {
        omrToggle.addEventListener('click', () => {
          document.getElementById('omrSidebar').classList.toggle('mobile-open');
        });
      }

      // Lightbox close
      document.getElementById('lightboxModal').addEventListener('click', (e) => {
        if (e.target.id === 'lightboxModal' || e.target.closest('.modal-close-btn')) {
          document.getElementById('lightboxModal').classList.remove('active');
        }
      });

      // Result modal close
      document.getElementById('resultModalClose').addEventListener('click', () => {
        document.getElementById('resultModal').classList.remove('active');
      });

      // Backup / Restore
      document.getElementById('exportBackupBtn')?.addEventListener('click', Storage.exportData);
      const importInput = document.getElementById('importBackupInput');
      if (importInput) {
        importInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            Storage.importData(e.target.files[0]);
          }
        });
      }
    },

    switchView(viewName) {
      document.querySelectorAll('.view-panel').forEach(panel => {
        panel.classList.remove('active');
      });

      // Update desktop nav
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-nav') === viewName);
      });

      const targetPanel = document.getElementById(`view${capitalize(viewName)}`);
      if (targetPanel) {
        targetPanel.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // View-specific initializations
      if (viewName === 'home') {
        this.renderDashboardStats();
      } else if (viewName === 'practiceSetup') {
        this.renderPracticeSetup();
      } else if (viewName === 'examHistory') {
        this.renderExamHistoryList();
      } else if (viewName === 'wrongNotes') {
        this.renderWrongNotesView();
      } else if (viewName === 'bookmarks') {
        this.renderBookmarksView();
      }
    },

    updateBadgeCounts() {
      const wrongCount = Object.keys(state.wrongNotes).length;
      const bookmarkCount = Object.keys(state.bookmarks).length;
      
      const wrongBadge = document.getElementById('wrongBadge');
      if (wrongBadge) {
        wrongBadge.textContent = wrongCount;
        wrongBadge.style.display = wrongCount > 0 ? 'flex' : 'none';
      }
      
      const bookmarkBadge = document.getElementById('bookmarkBadge');
      if (bookmarkBadge) {
        bookmarkBadge.textContent = bookmarkCount;
        bookmarkBadge.style.display = bookmarkCount > 0 ? 'flex' : 'none';
      }
    },

    renderDashboardStats() {
      document.getElementById('dashTotalQuestions').textContent = state.allQuestions.length.toLocaleString();
      document.getElementById('dashTotalSolved').textContent = state.stats.totalSolved.toLocaleString();
      
      const rate = state.stats.totalSolved > 0 
        ? Math.round((state.stats.totalCorrect / state.stats.totalSolved) * 100)
        : 0;
      document.getElementById('dashAccuracy').textContent = `${rate}%`;
      document.getElementById('dashWrongCount').textContent = Object.keys(state.wrongNotes).length.toLocaleString();
    },

    // --- Practice Setup View ---
    renderPracticeSetup() {
      // Extract unique subjects and years
      const subjects = Array.from(new Set(state.allQuestions.map(q => q.subject))).filter(Boolean);
      const years = Array.from(new Set(state.allQuestions.map(q => q.year))).sort().reverse();

      // Subjects Chips
      const subContainer = document.getElementById('practiceSubjectChips');
      subContainer.innerHTML = '';
      subjects.forEach(subj => {
        const isSelected = state.filter.selectedSubjects.length === 0 || state.filter.selectedSubjects.includes(subj);
        const chip = document.createElement('div');
        chip.className = `chip ${isSelected ? 'active' : ''}`;
        chip.textContent = subj;
        chip.onclick = () => {
          chip.classList.toggle('active');
          this.updateFilterSubjects();
        };
        subContainer.appendChild(chip);
      });

      // Years Chips
      const yearContainer = document.getElementById('practiceYearChips');
      yearContainer.innerHTML = '';
      years.forEach(yr => {
        // Default select recent 5 years (>= 2019)
        const isRecent = parseInt(yr, 10) >= 2019;
        const isSelected = state.filter.selectedYears.length === 0 ? isRecent : state.filter.selectedYears.includes(yr);
        const chip = document.createElement('div');
        chip.className = `chip ${isSelected ? 'active' : ''}`;
        chip.textContent = `${yr}년`;
        chip.setAttribute('data-year', yr);
        chip.onclick = () => {
          chip.classList.toggle('active');
          this.updateFilterYears();
        };
        yearContainer.appendChild(chip);
      });

      this.updateFilterSubjects();
      this.updateFilterYears();
    },

    updateFilterSubjects() {
      const activeChips = Array.from(document.querySelectorAll('#practiceSubjectChips .chip.active'));
      state.filter.selectedSubjects = activeChips.map(c => c.textContent);
      this.updateFilteredCountPreview();
    },

    updateFilterYears() {
      const activeChips = Array.from(document.querySelectorAll('#practiceYearChips .chip.active'));
      state.filter.selectedYears = activeChips.map(c => c.getAttribute('data-year'));
      this.updateFilteredCountPreview();
    },

    updateFilteredCountPreview() {
      let filtered = state.allQuestions;
      if (state.filter.selectedSubjects.length > 0) {
        filtered = filtered.filter(q => state.filter.selectedSubjects.includes(q.subject));
      }
      if (state.filter.selectedYears.length > 0) {
        filtered = filtered.filter(q => state.filter.selectedYears.includes(q.year));
      }
      const countEl = document.getElementById('filteredAvailableCount');
      if (countEl) countEl.textContent = filtered.length.toLocaleString();
    },

    // --- Start Modes ---
    startPracticeMode(options = {}) {
      let pool = state.allQuestions;
      
      // Filter subjects
      if (state.filter.selectedSubjects.length > 0) {
        pool = pool.filter(q => state.filter.selectedSubjects.includes(q.subject));
      }
      // Filter years
      if (state.filter.selectedYears.length > 0) {
        pool = pool.filter(q => state.filter.selectedYears.includes(q.year));
      }

      if (pool.length === 0) {
        alert('선택한 조건에 해당하는 문제가 없습니다. 필터를 다시 선택해 주세요.');
        return;
      }

      // Shuffle pool
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const count = options.count || state.filter.questionCount || 20;
      state.activeQuestions = count === 'all' ? shuffled : shuffled.slice(0, Math.min(count, shuffled.length));
      
      state.mode = 'practice';
      state.currentIndex = 0;
      state.userAnswers = {};
      state.checkedQuestions = {};
      state.examSubmitted = false;

      this.setupQuizWorkspace('스마트 랜덤 연습');
    },

    startExamMode(questionCount = 100, timeMinutes = 150) {
      // Pick questions for a standard exam (e.g. from a random real session or balanced across subjects)
      // Pick either a specific recent session or 100 balanced random questions
      const shuffled = [...state.allQuestions].sort(() => Math.random() - 0.5);
      state.activeQuestions = shuffled.slice(0, questionCount);

      state.mode = 'exam';
      state.currentIndex = 0;
      state.userAnswers = {};
      state.checkedQuestions = {};
      state.examSubmitted = false;
      state.examTotalTime = timeMinutes * 60;
      state.examTimeRemaining = timeMinutes * 60;

      this.startExamTimer();
      this.setupQuizWorkspace(`실전 모의고사 (${questionCount}문항 / ${timeMinutes}분)`);
    },

    startFixedExam(examDate) {
      const sessionQuestions = state.allQuestions
        .filter(q => q.examDate === examDate)
        .sort((a, b) => a.id - b.id);
        
      if (sessionQuestions.length === 0) {
        alert('해당 회차의 문제 데이터를 찾을 수 없습니다.');
        return;
      }

      state.activeQuestions = sessionQuestions;
      state.mode = 'exam';
      state.currentIndex = 0;
      state.userAnswers = {};
      state.checkedQuestions = {};
      state.examSubmitted = false;
      state.examTotalTime = 150 * 60;
      state.examTimeRemaining = 150 * 60;

      this.startExamTimer();
      this.setupQuizWorkspace(`${examDate} 기출 실전 풀이 (100문항)`);
    },

    startWrongNotesQuiz() {
      const wrongList = Object.values(state.wrongNotes);
      if (wrongList.length === 0) {
        alert('오답노트에 저장된 문제가 없습니다. 문제를 풀다가 틀린 문제가 생기면 자동으로 등록됩니다.');
        return;
      }

      state.activeQuestions = [...wrongList].sort(() => Math.random() - 0.5);
      state.mode = 'wrong';
      state.currentIndex = 0;
      state.userAnswers = {};
      state.checkedQuestions = {};
      state.examSubmitted = false;

      this.setupQuizWorkspace('오답노트 집중 복습');
    },

    startBookmarksQuiz() {
      const bookmarkedList = Object.values(state.bookmarks);
      if (bookmarkedList.length === 0) {
        alert('북마크한 문제가 없습니다. 문제 풀이 중 별 아이콘을 눌러 중요한 문제를 저장해 보세요.');
        return;
      }

      state.activeQuestions = [...bookmarkedList];
      state.mode = 'practice';
      state.currentIndex = 0;
      state.userAnswers = {};
      state.checkedQuestions = {};
      state.examSubmitted = false;

      this.setupQuizWorkspace('북마크 중요 문제 풀이');
    },

    // --- Exam Timer ---
    startExamTimer() {
      if (state.examTimerInterval) clearInterval(state.examTimerInterval);
      
      const timerBox = document.getElementById('examTimerBox');
      if (timerBox) timerBox.style.display = 'flex';
      
      const updateDisplay = () => {
        const mins = Math.floor(state.examTimeRemaining / 60);
        const secs = state.examTimeRemaining % 60;
        const timerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        document.getElementById('timerDisplay').textContent = timerText;
        
        if (state.examTimeRemaining <= 300) { // 5 minutes left
          timerBox.classList.add('timer-warning');
        } else {
          timerBox.classList.remove('timer-warning');
        }
        
        if (state.examTimeRemaining <= 0) {
          clearInterval(state.examTimerInterval);
          alert('시험 시간이 종료되었습니다! 답안이 자동으로 제출됩니다.');
          UI.submitExam();
        }
        state.examTimeRemaining--;
      };

      updateDisplay();
      state.examTimerInterval = setInterval(updateDisplay, 1000);
    },

    stopExamTimer() {
      if (state.examTimerInterval) {
        clearInterval(state.examTimerInterval);
        state.examTimerInterval = null;
      }
    },

    // --- Quiz Workspace Setup & Render ---
    setupQuizWorkspace(titleText) {
      this.switchView('quiz');
      document.getElementById('quizExamTitle').textContent = titleText;
      
      const isExam = state.mode === 'exam';
      document.getElementById('examTimerBox').style.display = isExam ? 'flex' : 'none';
      document.getElementById('toggleAnswerBtn').style.display = isExam ? 'none' : 'inline-flex';
      document.getElementById('submitExamBtn').style.display = isExam ? 'block' : 'none';

      this.renderOMRSheet();
      this.renderCurrentQuestion();
    },

    renderCurrentQuestion() {
      const q = state.activeQuestions[state.currentIndex];
      if (!q) return;

      const qKey = getQKey(q);
      const isExam = state.mode === 'exam';
      const isChecked = state.checkedQuestions[qKey] || (isExam && state.examSubmitted);
      const userAns = state.userAnswers[qKey];

      // Badges & Meta
      document.getElementById('qSubjectBadge').textContent = q.subject;
      document.getElementById('qYearBadge').textContent = `${q.year}년 기출 (${q.examDate})`;
      document.getElementById('qCurrentNum').textContent = `${state.currentIndex + 1} / ${state.activeQuestions.length}`;
      
      // Bookmark state
      const isBookmarked = !!state.bookmarks[qKey];
      const bmBtn = document.getElementById('qBookmarkBtn');
      bmBtn.classList.toggle('bookmarked', isBookmarked);
      bmBtn.innerHTML = isBookmarked ? '★' : '☆';

      // Title & Text
      document.getElementById('qNumberLabel').textContent = `${state.currentIndex + 1}.`;
      document.getElementById('qTextContent').textContent = q.question;

      // Question Diagram Image
      const imgWrap = document.getElementById('qImageWrap');
      const imgEl = document.getElementById('qImage');
      if (q.hasImage && q.image) {
        imgEl.src = `images/${q.image}`;
        imgWrap.style.display = 'block';
        imgWrap.onclick = () => UI.openLightbox(`images/${q.image}`);
      } else {
        imgWrap.style.display = 'none';
      }

      // Options Rendering
      const optionsContainer = document.getElementById('qOptionsContainer');
      optionsContainer.innerHTML = '';

      const circleChars = ['①', '②', '③', '④'];

      if (q.optionImages && q.optionImages.length === 4) {
        // 2x2 Grid of Option Images
        optionsContainer.className = 'options-grid-images';
        q.optionImages.forEach((optImg, idx) => {
          const optNum = idx + 1;
          const isSelected = userAns === optNum;
          
          let stateClass = '';
          if (isChecked) {
            if (optNum === q.answer) stateClass = 'correct-answer';
            else if (isSelected && optNum !== q.answer) stateClass = 'wrong-answer';
          } else if (isSelected) {
            stateClass = 'selected';
          }

          const optEl = document.createElement('div');
          optEl.className = `option-img-item ${stateClass}`;
          optEl.innerHTML = `
            <div class="opt-img-header">
              <span class="opt-circle">${circleChars[idx]}</span>
            </div>
            <div class="opt-img-box">
              <img src="images/${optImg}" alt="보기 ${optNum}">
            </div>
          `;
          optEl.onclick = () => UI.handleSelectOption(optNum);
          optionsContainer.appendChild(optEl);
        });
      } else {
        // Standard Options List
        optionsContainer.className = 'options-list';
        q.options.forEach((optText, idx) => {
          const optNum = idx + 1;
          const isSelected = userAns === optNum;

          let stateClass = '';
          if (isChecked) {
            if (optNum === q.answer) stateClass = 'correct-answer';
            else if (isSelected && optNum !== q.answer) stateClass = 'wrong-answer';
          } else if (isSelected) {
            stateClass = 'selected';
          }

          const optEl = document.createElement('div');
          optEl.className = `option-item ${stateClass}`;
          optEl.innerHTML = `
            <span class="opt-circle">${circleChars[idx]}</span>
            <span class="opt-text">${optText}</span>
          `;
          optEl.onclick = () => UI.handleSelectOption(optNum);
          optionsContainer.appendChild(optEl);
        });
      }

      // Immediate Feedback box (Practice mode)
      const feedbackBox = document.getElementById('qFeedbackBox');
      if (!isExam && isChecked) {
        feedbackBox.classList.add('active');
        const isCorrect = userAns === q.answer;
        feedbackBox.className = `feedback-box active ${isCorrect ? 'is-correct' : 'is-wrong'}`;
        document.getElementById('feedbackTitle').innerHTML = isCorrect 
          ? `✓ 정답입니다! (${circleChars[q.answer - 1]})`
          : `✗ 오답입니다. 정답은 ${circleChars[q.answer - 1]}번입니다.`;
        document.getElementById('feedbackDesc').textContent = isCorrect 
          ? '축하합니다! 핵심 이론을 정확하게 이해하고 계십니다.'
          : '틀린 문제는 오답노트에 자동으로 등록되었습니다. 복습하여 보완하세요.';
      } else {
        feedbackBox.classList.remove('active');
      }

      // Explanation & Memo Section Handling
      const savedMemo = state.userMemos[qKey];
      const memoDisplay = document.getElementById('userMemoDisplay');
      const memoEditor = document.getElementById('userMemoEditor');
      const memoContent = document.getElementById('userMemoContent');
      const memoInput = document.getElementById('userMemoInput');

      if (savedMemo) {
        memoDisplay.style.display = 'block';
        memoContent.textContent = savedMemo;
        memoEditor.style.display = 'none';
      } else {
        memoDisplay.style.display = 'none';
        memoEditor.style.display = 'none';
      }

      // Bind search buttons
      document.getElementById('searchCbtBtn').onclick = () => {
        const query = `site:comcbt.com 정보통신기사 ${q.question.slice(0, 35)}`;
        window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
      };

      document.getElementById('searchGoogleBtn').onclick = () => {
        const query = `정보통신기사 ${q.question.slice(0, 45)}`;
        window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
      };

      // Toggle Memo Editor
      document.getElementById('toggleMemoBtn').onclick = () => {
        const isEditing = memoEditor.style.display === 'flex';
        memoEditor.style.display = isEditing ? 'none' : 'flex';
        if (!isEditing) {
          memoInput.value = savedMemo || '';
          memoInput.focus();
        }
      };

      document.getElementById('editMemoBtn').onclick = () => {
        memoEditor.style.display = 'flex';
        memoInput.value = savedMemo || '';
        memoInput.focus();
      };

      document.getElementById('cancelMemoBtn').onclick = () => {
        memoEditor.style.display = 'none';
      };

      document.getElementById('saveMemoBtn').onclick = () => {
        const text = memoInput.value.trim();
        if (text) {
          state.userMemos[qKey] = text;
        } else {
          delete state.userMemos[qKey];
        }
        Storage.saveUserMemos();
        UI.renderCurrentQuestion();
      };

      // Nav buttons state
      document.getElementById('prevQBtn').disabled = state.currentIndex === 0;
      document.getElementById('nextQBtn').disabled = state.currentIndex === state.activeQuestions.length - 1;

      // Update progress bar
      const progressPercent = Math.round(((state.currentIndex + 1) / state.activeQuestions.length) * 100);
      document.getElementById('quizProgressBarFill').style.width = `${progressPercent}%`;
      document.getElementById('quizProgressText').textContent = `${state.currentIndex + 1} / ${state.activeQuestions.length}`;

      // Update OMR active row
      this.updateOMRState();
    },

    handleSelectOption(optNum) {
      if (state.mode === 'exam' && state.examSubmitted) return;

      const q = state.activeQuestions[state.currentIndex];
      const qKey = getQKey(q);

      state.userAnswers[qKey] = optNum;

      if (state.mode === 'practice' || state.mode === 'wrong') {
        // Immediate check in practice mode
        state.checkedQuestions[qKey] = true;
        
        // Update stats
        state.stats.totalSolved++;
        if (optNum === q.answer) {
          state.stats.totalCorrect++;
          // If solved correctly in wrong mode, ask or option to clear
          if (state.mode === 'wrong' && state.wrongNotes[qKey]) {
            // Keep resolved flag or delete
            delete state.wrongNotes[qKey];
            Storage.saveWrongNotes();
          }
        } else {
          // Add to wrong notes
          state.wrongNotes[qKey] = q;
          Storage.saveWrongNotes();
        }
        Storage.saveStats();
      }

      this.renderCurrentQuestion();
      this.updateOMRState();
    },

    toggleCheckAnswer() {
      const q = state.activeQuestions[state.currentIndex];
      const qKey = getQKey(q);
      state.checkedQuestions[qKey] = !state.checkedQuestions[qKey];
      this.renderCurrentQuestion();
    },

    toggleBookmark() {
      const q = state.activeQuestions[state.currentIndex];
      const qKey = getQKey(q);
      if (state.bookmarks[qKey]) {
        delete state.bookmarks[qKey];
      } else {
        state.bookmarks[qKey] = q;
      }
      Storage.saveBookmarks();
      this.renderCurrentQuestion();
    },

    navigateQuestion(direction) {
      const newIdx = state.currentIndex + direction;
      if (newIdx >= 0 && newIdx < state.activeQuestions.length) {
        state.currentIndex = newIdx;
        this.renderCurrentQuestion();
      }
    },

    // --- OMR Sheet Rendering & Updates ---
    renderOMRSheet() {
      const scrollArea = document.getElementById('omrScrollArea');
      scrollArea.innerHTML = '';

      state.activeQuestions.forEach((q, idx) => {
        const row = document.createElement('div');
        row.className = 'omr-row';
        row.id = `omrRow_${idx}`;
        
        const bubbles = [1, 2, 3, 4].map(num => `
          <button type="button" class="omr-bubble" data-qidx="${idx}" data-opt="${num}">
            ${num}
          </button>
        `).join('');

        row.innerHTML = `
          <span class="omr-q-num">${idx + 1}</span>
          <div class="omr-bubbles">${bubbles}</div>
        `;

        row.addEventListener('click', (e) => {
          const bubble = e.target.closest('.omr-bubble');
          if (bubble) {
            const optNum = parseInt(bubble.getAttribute('data-opt'), 10);
            state.currentIndex = idx;
            UI.handleSelectOption(optNum);
          } else {
            state.currentIndex = idx;
            UI.renderCurrentQuestion();
          }
        });

        scrollArea.appendChild(row);
      });

      this.updateOMRState();
    },

    updateOMRState() {
      const solvedCount = Object.keys(state.userAnswers).length;
      document.getElementById('omrAnsweredCount').textContent = solvedCount;
      document.getElementById('omrTotalCount').textContent = state.activeQuestions.length;

      state.activeQuestions.forEach((q, idx) => {
        const row = document.getElementById(`omrRow_${idx}`);
        if (!row) return;

        row.classList.toggle('active-q', idx === state.currentIndex);

        const qKey = getQKey(q);
        const userAns = state.userAnswers[qKey];
        const isChecked = state.checkedQuestions[qKey] || state.examSubmitted;

        const bubbles = row.querySelectorAll('.omr-bubble');
        bubbles.forEach(b => {
          const opt = parseInt(b.getAttribute('data-opt'), 10);
          b.className = 'omr-bubble';

          if (isChecked) {
            if (opt === q.answer) {
              b.classList.add('is-correct-mark');
            } else if (userAns === opt) {
              b.classList.add('is-wrong-mark');
            }
          } else if (userAns === opt) {
            b.classList.add('marked');
          }
        });
      });

      // Scroll active row into view in OMR
      const activeRow = document.getElementById(`omrRow_${state.currentIndex}`);
      if (activeRow) {
        activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    },

    // --- Submit Exam & Result Calculation ---
    submitExam() {
      const unanswered = state.activeQuestions.length - Object.keys(state.userAnswers).length;
      if (unanswered > 0 && state.examTimeRemaining > 0) {
        if (!confirm(`아직 마킹하지 않은 문제가 ${unanswered}문항 남아있습니다. 정말 시험을 종료하고 제출하시겠습니까?`)) {
          return;
        }
      }

      this.stopExamTimer();
      state.examSubmitted = true;
      state.stats.examsCompleted++;

      // Grade exam
      let totalCorrect = 0;
      const subjectStats = {};

      state.activeQuestions.forEach(q => {
        const qKey = getQKey(q);
        const userAns = state.userAnswers[qKey];
        const isCorrect = userAns === q.answer;

        state.stats.totalSolved++;
        if (isCorrect) {
          totalCorrect++;
          state.stats.totalCorrect++;
        } else {
          state.wrongNotes[qKey] = q;
        }

        if (!subjectStats[q.subject]) {
          subjectStats[q.subject] = { total: 0, correct: 0 };
        }
        subjectStats[q.subject].total++;
        if (isCorrect) subjectStats[q.subject].correct++;
      });

      Storage.saveWrongNotes();
      Storage.saveStats();

      // Check pass/fail (Standard KISA: Avg >= 60, No subject < 40)
      const avgScore = Math.round((totalCorrect / state.activeQuestions.length) * 100);
      let hasFailedSubject = false;

      Object.entries(subjectStats).forEach(([subj, data]) => {
        const subjScore = Math.round((data.correct / data.total) * 100);
        if (subjScore < 40) hasFailedSubject = true;
      });

      const isPass = avgScore >= 60 && !hasFailedSubject;

      // Render Result Modal
      const modal = document.getElementById('resultModal');
      const badge = document.getElementById('resultBadge');
      badge.textContent = isPass ? '🎉 최종 합격' : '⚠️ 불합격 (재도전 필요)';
      badge.className = `result-badge ${isPass ? 'pass' : 'fail'}`;

      document.getElementById('resultScoreBig').textContent = `${avgScore}점`;
      document.getElementById('resultSummaryText').textContent = 
        `총 ${state.activeQuestions.length}문항 중 ${totalCorrect}문항 정답 (정답률 ${avgScore}%)`;

      // Breakdown list
      const breakdownEl = document.getElementById('resultSubjectBreakdown');
      breakdownEl.innerHTML = '';
      Object.entries(subjectStats).forEach(([subj, data]) => {
        const sScore = Math.round((data.correct / data.total) * 100);
        const row = document.createElement('div');
        row.className = 'subject-score-row';
        row.innerHTML = `
          <span class="subj-name">${subj} (${data.correct}/${data.total})</span>
          <span class="subj-score ${sScore < 40 ? 'fail-score' : ''}">
            ${sScore}점 ${sScore < 40 ? '(과락)' : ''}
          </span>
        `;
        breakdownEl.appendChild(row);
      });

      modal.classList.add('active');

      // Update workspace so user can review answers
      this.renderCurrentQuestion();
      this.updateOMRState();
    },

    // --- Lightbox for Images ---
    openLightbox(imgSrc) {
      const modal = document.getElementById('lightboxModal');
      document.getElementById('lightboxImg').src = imgSrc;
      modal.classList.add('active');
    },

    // --- Exam History View ---
    renderExamHistoryList() {
      const container = document.getElementById('examHistoryGrid');
      container.innerHTML = '';

      // Group by examDate
      const examMap = {};
      state.allQuestions.forEach(q => {
        if (!examMap[q.examDate]) {
          examMap[q.examDate] = {
            date: q.examDate,
            year: q.year,
            count: 0,
            hasImages: 0
          };
        }
        examMap[q.examDate].count++;
        if (q.hasImage || q.optionImages) examMap[q.examDate].hasImages++;
      });

      const sortedSessions = Object.values(examMap).sort((a, b) => b.date.localeCompare(a.date));

      sortedSessions.forEach(session => {
        const card = document.createElement('div');
        card.className = 'mode-card card-history';
        card.innerHTML = `
          <div class="mode-icon">📅</div>
          <div class="mode-title">${session.date} 기출 시험</div>
          <div class="mode-desc">
            전체 100문항 (5개 과목) 구성<br>
            회로도/도표 시각자료 ${session.hasImages}문항 포함
          </div>
          <div class="mode-footer">
            <span class="mode-tag">${session.year}년 시행</span>
            <span class="mode-action-btn">정주행 시작 →</span>
          </div>
        `;
        card.onclick = () => UI.startFixedExam(session.date);
        container.appendChild(card);
      });
    },

    // --- Wrong Notes View ---
    renderWrongNotesView() {
      const listEl = document.getElementById('wrongNotesList');
      const emptyEl = document.getElementById('wrongNotesEmpty');
      const items = Object.values(state.wrongNotes);

      if (items.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
      }

      emptyEl.style.display = 'none';
      listEl.innerHTML = '';

      items.forEach(q => {
        const qKey = getQKey(q);
        const savedMemo = state.userMemos[qKey];
        const memoHtml = savedMemo ? `
          <div style="margin-top: 0.6rem; padding: 0.6rem 0.8rem; background: rgba(245, 158, 11, 0.08); border-left: 3px solid #fbbf24; border-radius: 4px; font-size: 0.85rem; color: var(--text-secondary);">
            <strong style="color: #fbbf24;">📝 나의 해설:</strong> ${savedMemo}
          </div>
        ` : '';

        const card = document.createElement('div');
        card.className = 'note-item-card';
        card.innerHTML = `
          <div class="note-card-top">
            <div class="meta-badges">
              <span class="q-badge subject-badge">${q.subject}</span>
              <span class="q-badge year-badge">${q.examDate}</span>
              <span class="q-badge">Q.${q.id}</span>
            </div>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="window.open('https://www.google.com/search?q=' + encodeURIComponent('site:comcbt.com 정보통신기사 ' + '${q.question.slice(0, 30)}'), '_blank')">
                comcbt 해설
              </button>
              <button type="button" class="btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" data-del="${qKey}">
                삭제
              </button>
            </div>
          </div>
          <div class="note-q-title">${q.question}</div>
          <div style="font-size: 0.9rem; color: #10b981; font-weight: 600;">
            정답: ${q.answer}번 (${['①','②','③','④'][q.answer - 1]})
          </div>
          ${memoHtml}
        `;
        card.querySelector('[data-del]').onclick = (e) => {
          e.stopPropagation();
          delete state.wrongNotes[qKey];
          Storage.saveWrongNotes();
          UI.renderWrongNotesView();
        };
        listEl.appendChild(card);
      });
    },

    // --- Bookmarks View ---
    renderBookmarksView() {
      const listEl = document.getElementById('bookmarksList');
      const emptyEl = document.getElementById('bookmarksEmpty');
      const items = Object.values(state.bookmarks);

      if (items.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
      }

      emptyEl.style.display = 'none';
      listEl.innerHTML = '';

      items.forEach(q => {
        const qKey = getQKey(q);
        const savedMemo = state.userMemos[qKey];
        const memoHtml = savedMemo ? `
          <div style="margin-top: 0.6rem; padding: 0.6rem 0.8rem; background: rgba(245, 158, 11, 0.08); border-left: 3px solid #fbbf24; border-radius: 4px; font-size: 0.85rem; color: var(--text-secondary);">
            <strong style="color: #fbbf24;">📝 나의 해설:</strong> ${savedMemo}
          </div>
        ` : '';

        const card = document.createElement('div');
        card.className = 'note-item-card';
        card.innerHTML = `
          <div class="note-card-top">
            <div class="meta-badges">
              <span class="q-badge subject-badge">${q.subject}</span>
              <span class="q-badge year-badge">${q.examDate}</span>
              <span class="q-badge">Q.${q.id}</span>
            </div>
            <button type="button" class="btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;" data-del="${qKey}">
              해제
            </button>
          </div>
          <div class="note-q-title">${q.question}</div>
          <div style="font-size: 0.9rem; color: #10b981; font-weight: 600;">
            정답: ${q.answer}번 (${['①','②','③','④'][q.answer - 1]})
          </div>
          ${memoHtml}
        `;
        card.querySelector('[data-del]').onclick = (e) => {
          e.stopPropagation();
          delete state.bookmarks[qKey];
          Storage.saveBookmarks();
          UI.renderBookmarksView();
        };
        listEl.appendChild(card);
      });
    }
  };

  // Helper
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // --- App Initialization & Data Fetch ---
  async function initApp() {
    Storage.load();
    UI.init();

    try {
      const res = await fetch('questions.json');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      state.allQuestions = await res.json();
      state.loaded = true;
      console.log(`Loaded ${state.allQuestions.length} questions.`);
      UI.renderDashboardStats();
    } catch (err) {
      console.error('Failed to load questions.json:', err);
      alert('문제 데이터(questions.json)를 불러오는데 실패했습니다.');
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('ServiceWorker registered:', reg.scope))
          .catch(err => console.log('ServiceWorker registration failed:', err));
      });
    }
  }

  // Expose UI to global scope for inline button handlers
  window.UI = UI;
  window.Storage = Storage;

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
