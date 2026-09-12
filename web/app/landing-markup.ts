// Generated from the landing design — static, no scripts, no user input.
// Edited only to swap the placeholder mark for the real logo.
export const LANDING_MARKUP = String.raw`

<!-- The mark: a page with the unread part cut out of it. -->
<svg width="0" height="0" aria-hidden="true" style="position:absolute">
  <symbol id="m" viewBox="0 0 100 100">
    <path fill="currentColor" d="M8 4h84v50L64 96H8V46L36 4H8z"/>
    <path fill="currentColor" opacity="0" d="M0 0h0v0z"/>
  </symbol>
</svg>

<header class="band hero">
  <div class="in">
    <div class="hero-art">
      <svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><use href="#m"/></svg>

      <div class="paper" aria-hidden="true">
        <svg viewBox="0 0 240 96" fill="none">
          <path class="ln s1" d="M4 13c7-6 11 4 17 1s5-8 11-7 4 9 10 8 6-8 12-7 3 8 9 8 7-7 13-6 4 7 10 7 6-6 12-5 5 6 11 5 6-5 12-4 5 5 11 4"/>
          <path class="ln s2" d="M4 34c8-5 10 5 17 2s4-8 11-6 3 9 10 7 5-8 12-6 3 8 10 6 6-7 13-5 4 7 11 6 5-6 12-4 5 6 12 4 5-5 12-3 5 5 12 3"/>
          <path class="ln s3" d="M4 55c9 3 6-6 14-4s3 9 11 8 5-9 12-6 2 9 10 7 6-8 13-5 3 8 11 6 5-7 12-4 4 7 12 5"/>
          <path class="ln s4" d="M4 76c7-5 10 4 16 2s5-7 11-5 3 8 10 6 5-7 12-5 3 7 10 5 5-6 12-4"/>
        </svg>
      </div>

      <div class="status" aria-hidden="true">
        <span class="s1"><i></i>reading</span>
        <span class="s2"><i></i>stopped, asking</span>
        <span class="s3"><i></i>resolved, marking</span>
      </div>

      <div class="spec">
        <dl>
          <dt>03</dt><dd><span class="rd r1">পদার্থের তিনটি অবস্থা আছে। কঠিন, তরল</span></dd>
          <dt>04</dt><dd><span class="rd r2">এবং <span class="w"><span class="w-raw bn" lang="bn">গ্যাসীয়</span><span class="w-flag bn" lang="bn">[[অস্পষ্ট]]</span><span class="w-ok bn" lang="bn">গ্যাসীয়</span></span> অবস্থায় অণুগুলো</span></dd>
          <dt>05</dt><dd><span class="rd r3">দূরে থাকে, তাই আয়তন নির্দিষ্ট নয়।</span></dd>
        </dl>
        <p class="turn a"><span class="who">agent</span><span class="what">Line 04, one word here could not be read. What does it say?</span></p>
        <p class="turn b"><span class="who">student</span><span class="what bn" lang="bn">গ্যাসীয়</span></p>
      </div>
    </div>

    <div class="hero-copy">
      <div class="topline">
        <img src="/logo.png" alt="" width="26" height="26" class="logo-sm">
        <span class="wm">Nirikkha <span class="bn" lang="bn">নিরীক্ষা</span></span>
      </div>
      <h1>When it cannot read a line, it does not <span class="g">guess<svg viewBox="0 0 240 18" aria-hidden="true"><path d="M4 12c34-7 62 3 96-2s58-6 86 1c14 3 28 1 46-4"/></svg></span>. It asks.</h1>
      <p class="lede">
        A marking agent for handwritten exam scripts. It reads a photograph, marks four
        parts against their own rubric, explains every mark, and stops the moment it meets
        a word it cannot make out.
      </p>
      <div class="cta-row">
        <a class="btn" href="https://github.com/uttamdeb/nirikkha">Read the source &rarr;</a>
        <a class="btn ghost" href="/dashboard">Open the app &rarr;</a>
      </div>
    </div>
  </div>
</header>

<section class="band b-dark">
  <div class="in">
    <div class="head">
      <h2>Two agents,<br>one gate between them</h2>
      <div class="aside">
        <p class="lab">Read &rarr; gate &rarr; mark &rarr; release</p>
        <a class="btn light" href="https://github.com/uttamdeb/nirikkha/blob/main/api/app/pipeline.py">See the pipeline</a>
      </div>
    </div>

    <div class="pipe">
      <ol class="idx">
        <li><span class="n">01</span><span class="t">Photograph, up to three pages</span></li>
        <li><span class="n">02</span><span class="t">Read into numbered lines</span></li>
        <li class="on">
          <span class="n">03</span><span class="arrow">&rarr;</span>
          <span class="t">Confidence gate
            <small>Words the reader could not make out are pinned in place and the script
            stops. Nothing is marked on invented text.</small>
          </span>
        </li>
        <li><span class="n">04</span><span class="t">Mark four parts independently</span></li>
        <li><span class="n">05</span><span class="t">Teacher reviews and corrects</span></li>
        <li><span class="n">06</span><span class="t">Release to the student</span></li>
      </ol>

      <div class="stack" aria-hidden="true">
        <svg viewBox="0 0 100 100"><use href="#m"/></svg>
        <svg viewBox="0 0 100 100"><use href="#m"/></svg>
        <svg viewBox="0 0 100 100"><use href="#m"/></svg>
        <svg viewBox="0 0 100 100"><use href="#m"/></svg>
      </div>
    </div>
  </div>
</section>

<section class="band b-pale">
  <div class="in">
    <div class="head">
      <h2>One stimulus.<br>Four questions, climbing.</h2>
      <p class="lab" style="max-width:30ch; line-height:1.8">
        The national Creative Question format<br>marked in Bangladeshi secondary schools
      </p>
    </div>

    <div class="rubric">
      <div class="row">
        <span class="p">a</span><span class="m">1 mark</span>
        <span class="d"><strong>Recall</strong><p>State a definition or a fact from the syllabus.</p></span>
      </div>
      <div class="row">
        <span class="p">b</span><span class="m">2 marks</span>
        <span class="d"><strong>Comprehension</strong><p>Explain the concept in your own words.</p></span>
      </div>
      <div class="row">
        <span class="p">c</span><span class="m">3 marks</span>
        <span class="d"><strong>Application</strong><p>Apply the concept to the stimulus given.</p></span>
      </div>
      <div class="row">
        <span class="p">d</span><span class="m">4 marks</span>
        <span class="d"><strong>Judgement</strong><p>Evaluate or argue a position, using the stimulus as evidence.</p></span>
      </div>
      <div class="row sum">
        <span class="p">10</span><span class="m">total</span>
        <span class="d"><p>Summed in code, never taken from a model. Labelled
          <span class="bn" lang="bn">ক খ গ ঘ</span> in Bengali, the first four letters of the
          alphabet.</p></span>
      </div>
    </div>
  </div>
</section>

<section class="band b-white">
  <div class="in">
    <h2 style="font-size:var(--s-2)">FAQ</h2>

    <div class="faq">
      <details>
        <summary><span class="tog">&uarr;</span> Is this an auto-grader that replaces the teacher?</summary>
        <div class="ans"><div class="ans-in">
          <p class="claim">&rarr; No. A human always releases.</p>
          <div class="detail">
            <p>The pipeline cannot publish a result on its own. It ends at
              <code>awaiting_teacher</code>, and everything before that is provisional and
              labelled as such on every surface.</p>
            <p>Teacher corrections are append only. The agent's original value stays beside
              the corrected one, and the student is told whose words they are reading.</p>
          </div>
        </div></div>
      </details>

      <details open>
        <summary><span class="tog">&darr;</span> What happens when the handwriting is unreadable?</summary>
        <div class="ans"><div class="ans-in">
          <p class="claim">&rarr; It marks the exact word and stops.</p>
          <div class="detail">
            <p>The reader writes a marker, <span class="bn" lang="bn">[[অস্পষ্ট]]</span>,
              Bengali for <em>unclear</em>, in place of the word it could not make out. Those
              lines fall below the legibility threshold, the submission moves to
              <code>awaiting_student</code>, and marking stops.</p>
            <p>The student is asked what the line says, answers in the same chat thread, and
              marking resumes automatically once the last one is resolved. A first result
              coming back unresolved is the system working, not an error.</p>
          </div>
        </div></div>
      </details>

      <details>
        <summary><span class="tog">&uarr;</span> Why not just let the model guess? It is usually right.</summary>
        <div class="ans"><div class="ans-in">
          <p class="claim">&rarr; A guess and a reading look identical.</p>
          <div class="detail">
            <p>A vision model gives no signal separating a confident read from an invention,
              so a wrong guess travels all the way to the student's result looking exactly
              like a correct one.</p>
            <p>Asking the model for a confidence score does not help either. It returns
              roughly the same number for every line, which leaves the gate nothing to
              threshold on. Marking the exact word pins the failure to a span instead.</p>
          </div>
        </div></div>
      </details>

      <details>
        <summary><span class="tog">&uarr;</span> Where does the agent actually live?</summary>
        <div class="ans"><div class="ans-in">
          <p class="claim">&rarr; The class group chat, and the teacher's own AI client.</p>
          <div class="detail">
            <p>Students send an exam code and a photo to a chat bot, and the clarification
              arrives as a reply in the same thread. No account, no install.</p>
            <p>Teachers work through an MCP server: ten tools over <code>POST /mcp</code> with
              OAuth 2.1, so they list flagged scripts, fix a misread line, mark it again and
              release from ChatGPT or Claude. A web panel covers the same ground.</p>
          </div>
        </div></div>
      </details>

      <details>
        <summary><span class="tog">&uarr;</span> Am I locked into one model provider?</summary>
        <div class="ans"><div class="ans-in">
          <p class="claim">&rarr; No. Both stages swap by environment variable.</p>
          <div class="detail">
            <p>Reading and grading each sit behind one interface, and no provider name appears
              outside its own adapter. The grading agent only ever sees text, so it needs no
              vision capability at all.</p>
            <p>Stub providers are built in, so the whole pipeline runs end to end with no API
              keys.</p>
          </div>
        </div></div>
      </details>
    </div>
  </div>
</section>

<section class="band close">
  <div class="in">
    <h2>A grade nobody<br>had to <span class="a">&rarr;</span> invent</h2>
    <p class="sub">
      Read the source, or connect the marking agent to your own MCP client and send it a
      script.
    </p>
    <div class="cta-row" style="margin-top:clamp(1.75rem,3.5vw,2.5rem)">
      <a class="btn" href="https://github.com/uttamdeb/nirikkha">github.com/uttamdeb/nirikkha &rarr;</a>
      <a class="btn ghost" href="/dashboard">Open the app &rarr;</a>
    </div>

    <div class="proof">
      <span class="lab" style="color:var(--ink-low)">Shipping</span>
      <span><b>10</b> MCP tools, live</span>
      <span><b>46</b> unit tests passing</span>
      <span><b>MIT</b> licensed</span>
    </div>
  </div>
</section>

<footer class="band">
  <div class="in">
    <div class="fgrid">
      <div class="fcol">
        <h3>Nirikkha</h3>
        <ul>
          <li><span>A marking agent for handwritten<br>Creative Question answer scripts.</span></li>
          <li class="grp"><a href="/dashboard">Open the app &rarr;</a></li>
          <li><a href="https://github.com/uttamdeb/nirikkha">Source on GitHub &rarr;</a></li>
        </ul>
      </div>

      <div class="fcol">
        <h3>Surfaces</h3>
        <ul>
          <li><span>Chat bot</span></li>
          <li><span>MCP server</span></li>
          <li><span>Teacher panel</span></li>
          <li><span>Web app</span></li>
        </ul>
        <h3 class="grp">Pipeline</h3>
        <ul>
          <li><span>Reading agent</span></li>
          <li><span>Confidence gate</span></li>
          <li><span>Grading agent</span></li>
          <li><span>Teacher review</span></li>
        </ul>
      </div>

      <div class="fcol">
        <h3>Guarantees</h3>
        <ul>
          <li><span>Totals summed in code</span></li>
          <li><span>Human releases every result</span></li>
          <li><span>Stale transcripts cannot publish</span></li>
          <li><span>Overrides are append only</span></li>
        </ul>
        <h3 class="grp">Docs</h3>
        <ul>
          <li><a href="https://github.com/uttamdeb/nirikkha/blob/main/docs/MCP.md">MCP reference &rarr;</a></li>
          <li><a href="https://github.com/uttamdeb/nirikkha/blob/main/AGENTS.md">Engineering notes &rarr;</a></li>
        </ul>
      </div>
    </div>

    <div class="fsign">
      <div class="big">
        <img src="/logo.png" alt="" class="logo-lg">
        <span class="t">Nirikkha
          <span class="bn" lang="bn">পড়ালেখা হোক নির্বিঘ্নে</span>
        </span>
      </div>
      <p class="meta">
        <a href="https://github.com/uttamdeb/nirikkha">GitHub</a><br>
        MIT licensed<br>
        &copy;2026
      </p>
    </div>
  </div>
</footer>

`;
