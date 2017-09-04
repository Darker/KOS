// ==UserScript==44
// @name        zapisator
// @namespace   util
// @description Zapis predmetu bez picovin
// @include     https://www.kos.cvut.cz/*
// @version     1
// @resource    STYLE  zapisator.user.css
// @grant       none
// @run-at      document-end
// ==/UserScript==
const css_elm = document.createElement("link");
css_elm.href = "";
css_elm.rel = "stylesheet";
document.head.appendChild(css_elm);
//css_elm.innerHTML = GM_getResourceText("STYLE");
//document.head.appendChild(css_elm);
//console.log(["a", "b", "c"]);

const URL_SUBJECT_DETAIL = "/kos/ttOnesubjectsCVUT.do";
const REGEX_PAGE_CODE = /var[ \t]+pageCode[ \t]*=[ \t]*'([a-z0-9]+)'[ \t]*;/i;
const REGEX_SUBJECT_DETAIL_INFO = /viewSubject\('([a-z-0-9]+)', *'([0-9]+)', *'([^']*)', *'([^']*)', *'([^']*)'\)/i;
const REGEX_CLEAR_WHITESPACE = /[\s\t]/g;
/**
 * Clears averything except for numbers and comma
 */
const REGEX_CLEAR_SUBJECT_GROUP = /[^0-9\-]/g;
//                         pno  cno    lno
// javascript:writeSubject('1', '101', '');
const REGEX_SUBJECT_SIGN_UP_PARAMS = /writeSubject\('([0-9]*)', *'([0-9]*)', *'([0-9]*)' *\)/i;
/**
 * @param {number} a
 * @param {number} b
 */
const SORT_NUMBER_ASCENDING = (a, b) => a - b;


const SUBJECT_ENTRIES = ["group", "type", "teacher", "capacity", "occupied"];
SUBJECT_ENTRIES.length = 18;
SUBJECT_ENTRIES[17] = "signup";
/**
 * @type {Array<Array<string>>} HOURS
 */
const HOURS = [
    ["7:30", "8:15"],
    ["8:15", "9:00"],
    ["9:15", "10:00"],
    ["10:00", "10:45"],
    ["11:00", "11:45"],
    ["11:45", "12:30"],
    ["12:45", "13:30"],
    ["13:30", "14:15"],
    ["14:30", "15:15"],
    ["15:15", "16:00"],
    ["16:15", "17:00"],
    ["17:00", "17:45"],
    ["18:00", "18:45"],
    ["19:00", "19:30"],
    ["19:30", "20:30"]
];

/**
 * @type {Array<string>} DAYS
 */
const DAYS = window.DAYS = [
    ["Po","L"],
    ["Po","S"],
    ["Ut","L"],
    ["Ut","S"],
    ["St","L"],
    ["St","S"],
    ["Ct","L"],
    ["Ct","S"],
    ["Pa","L"],
    ["Pa", "S"],
    ["So", "L"],
    ["So", "S"],
];
/// Map between days and row indices
/// key format is DAY_WEEK
const DAY_INDICES = {};
for (let i = 0, l = DAYS.length; i < l; ++i) {
    //console.log(DAYS[i]);
    DAY_INDICES[DAYS[i][0].toLowerCase() + "_" + DAYS[i][1].toUpperCase()] = i;
}

/**
 * Returns the other week ID, that is "S" (even) for "L" (odd) and vice versa
 * @param {string} week
 * @returns {string}="L"|"S"
 */
function otherWeek(week) {
    return week.toUpperCase() == "S" ? "L" : "S";
}


class TimesheetTime {
    /**
     * @param {string} week - "L" or "S" or ""
     * @param {string} day - "po", "ut" etc
     * @param {Array<number>|Array<string>|number} hours - [1,2,3] - MUST BE CONTINOUS! This class takes ownership of hours!
     * @throws {Error} if the list of hours is not continous, eg "1+3"
     */
    constructor(week, day, hours) {
        if (typeof day != "string")
            throw new Error("Day is not string: " + day);
        /** @type {string} this.day **/
        this.day = day.toLowerCase();
        // Sanitize week input
        if (typeof week=="string" && week.length > 0) {
            week = week.toUpperCase().replace(/[^SL]/, "");
            if (week != "S" && week != "L")
                throw new Error("Invalid week: " + week + " " + week.length);
        }
        else {
            week = "";
        }

        /** @type {string} this.week **/
        this.week = week;
        /** @type {Array<number>} this.hours **/
        this.hours = hours instanceof Array?hours:[hours];
        this.hours.mapSelf((hr)=>1*hr)
        this.hours.sort(SORT_NUMBER_ASCENDING);
        /// test for continousnes
        let lastHour = this.hours[0];
        for (let i = 1, l = this.hours.length; i < l; ++i) {
            if (this.hours[i] - 1 != lastHour) {
                throw new Error("Time not continous! " + this.hours.join(", "));
            }
            else {
                lastHour = this.hours[i];
            }
        }
    }
    /**
     * 
     * @param {TimesheetTime} time
     * @returns {boolean} true if the times share at least one hour
     */
    overlaps(time) {
        // first check if days overlap
        if (time.day == this.day && (this.week == "" || time.week == "" || this.week == time.week)) {
            /// now check hours
            for (let i = 0, l = this.hours.length; i < l; ++i) {
                if (time.hours.indexOf(this.hours[i])!=-1)
                    return true;
            }
        }
        return false;
    }
    /**
     * Appends given time to this time - hours and days
     * @param {TimesheetTime} time
     */
    concat(time) {
        // Check if they are same day
        if (time.day == this.day) {
            // check if the hours match or toutch
            let toutch = false;
            for (let i = 0, l = this.extendedHours.length; i < l; ++i) {
                if (time.hours.indexOf(this._extendedHours[i])) {
                    toutch = true;
                    break;
                }
            }
            if (toutch) {
                this.addHours(time.hours);
                // Delete the week info if the weeks are the opposite
                if (otherWeek(this.week) == time.week) {
                    this.week = "";
                }
            }
            else {
                throw new Error("Cannot merge times if the do not toutch.");
            }
        }
        else {
            throw new Error("Given time is another day");
        }
    }
    /**
     * Adds hours to the entry
     * @param {Array<number>} hours - SORTED! array of hours
     * @throws {Error} if the hours do not fall into the extended interval of this lesson
     */
    addHours(hours) {
        let changed = false;
        for (let i = 0, l = hours.length; i < l; ++i) {
            const hour = hours[i];
            // hour already included
            if (this.hours.indexOf(hour) != -1)
                continue;
            this.hours.push(hour);
            changed = true;
        }
        this.hours.sort(SORT_NUMBER_ASCENDING);
        if (changed)
            this._extendedHours = null;
    }
    /**
     @property {Array<number>} extendedHours Hours including the hour before and after this lesson
    **/
    get extendedHours() {
        if (this._extendedHours) {
            return this._extendedHours;
        }
        else {
            const extended = [];
            // add hour before
            if (this.hours[0] > 1) {
                extended.push(this.hours[0]-1)
            }
            extended.push.apply(extended, this.hours);
            //add hour after
            if (this.hours[this.hours.length] < 15) {
                extended.push(this.hours[this.hours.length] + 1)
            }
            return this._extendedHours = extended;
        }
    }
    /**
     * Splits the time into individual hours
     * @returns {Array<TimesheetTime>} returns array with itself if contains only one hour
     */
    splitInHours() {
        if (this.hours.length == 1)
            return [this];
        const hours = [];
        for (let i = 0, l = this.hours.length; i < l; ++i) {
            hours.push(new TimesheetTime(this.week, this.day, this.hours[i]));
        }
        return hours;
    }
    /**
     * 
     * @param {number} hour
     * @param {string} day
     * @param {string} week
     * @returns {boolean} true if the time interval contains given time
     */
    contains(hour, day, week) {
        return day == this.day && (this.week == "" || week=="" || this.week == week) && this.hours.indexOf(hour) != -1;
    }
}

class LessonTime extends TimesheetTime {
    /**
     * @param {string} week
     * @param {string} day
     * @param {Array<number>|Array<string>|number} hours
     * @param {SubjectLesson} lesson
     * @throws {Error} if the list of hours is not continous, eg "1+3"
     */
    constructor(week, day, hours, lesson) {
        super(week, day, hours);
        this.lesson = lesson;
        this.html = document.createElement("div");
        this.html.classList.add("subject");

        this.nodeSubjectName = new Text("");
        this.html.appendChild(this.nodeSubjectName);
    }
    /**
     * Checks if the previous or next time is the same lesson and adjusts borders (note: first, ordering must be OK)
     */
    checkBorders() {
        throw new Error("Cannot be done until the lessons are correctly aligned.");
    }
    /**
     * Prepares HTML contents.
     * @returns {HTMLDivElement} the container
     */
    initHTML() {
        if (!this.html_initialized) {
            this.html_initialized = true;
            // Global hover for all time instances
            this.html.addEventListener("mouseenter", () => {
                if (this.lesson.signupURL.length > 0)
                    this.lesson.hovered(true);
            });
            this.html.addEventListener("mouseleave", () => {
                if (this.lesson.signupURL.length > 0)
                    this.lesson.hovered(false);
            });
            this.html.addEventListener("click", () => {
                if (this.lesson.signupURL.length > 0 && !this.lesson.isLecture() && !this.lesson.isLoading() && !this.lesson.signedUp) {
                    if (this.lesson.capacity <= this.lesson.occupied) {
                        alert("This lesson has " + this.lesson.occupied + " out of maximum " + this.lesson.capacity + " students signed up.");
                    }
                    else if (confirm("Sign up for this lesson?"))
                        this.lesson.signUp();
                }
            });
            this.html.time = this;
            this.html.lesson = this.lesson;
            this.html.setAttribute("text", "text");
        }

        this.html.classList.remove("signed", "locked", "capacity", "loading", "lecture", "group-signed", "error");
        this.html.title = "";
        if (this.lesson.isLecture()) {
            this.html.classList.add("signed", "lecture");
        }
        else if (this.lesson.signupURL == "" && !this.lesson.signedUp) {
            this.html.classList.add("locked");
            this.html.title = "Cannot find the signup button.";
        }
        if (this.lesson.capacity <= this.lesson.occupied && !this.lesson.signedUp) {
            this.html.classList.add("locked", "capacity");
            this.html.title = "This lesson is full!";
        }
        if (this.lesson.signedUp)
            this.html.classList.add("signed");
        else if (this.lesson.groupSigned)
            this.html.classList.add("group-signed");


        if (this.lesson.isLoading()) {
            this.html.classList.add("loading");
        }
        this.nodeSubjectName.data = this.lesson.subjectName;
        return this.html;
    }
}
/**
 * @property {string} subjectName
 * @property {string} SubjectLesson.subjectID
 * @property {Array<TimesheetTime>} times
 */
class SubjectLesson {
    /**
     * 
     * @param {Object} dataObj
     */
    constructor(dataObj = {}) {
        /** @type {string} this.subjectID **/
        this.subjectID = dataObj.subjectID||"";
        /** @type {string} this.subjectName **/
        this.subjectName = dataObj.subjectName || "";
        /** @type {string} this.semesterId **/
        this.semesterId = dataObj.semesterId || "";
        /** @type {string} this.semesterName **/
        this.semesterName = dataObj.semesterName || "";
        /** @type {Document} this.sourceDocument **/
        this.sourceDocument = dataObj.sourceDocument || null;
        /** @type {boolean} this.signedUp **/
        this.signedUp = dataObj.signedUp || false;
        /** @type {string} this.type **/
        this.type = dataObj.type || "";
        this.group = dataObj.group;
        this.teacher = dataObj.teacher;
        this.capacity = dataObj.capacity || Infinity;
        this.occupied = dataObj.occupied || 0;
        this.location = dataObj.location;
        /** @type {string} this.signupURL **/
        this.signupURL = dataObj.signupURL||"";
        /** @type {Array<SubjectLesson>} this.lessonGroup **/
        this.lessonGroup = dataObj.lessonGroup || [];
        /** @type {Array<LessonTime>} this.times */
        this.times = [];
        if (dataObj.times) {
            dataObj.times.forEach((time) => {
                this.times.push(new LessonTime(time.day, time.hours));
            });
        }
        this.loading = false;
        this.groupSigned = false;
    }
    /**
     * Returns true if this is lecture.
     */
    isLecture() {
        return this.type.removeAccents().indexOf("ednaska") != -1;
    }
    /**
     * Returns the identifier of the student paralel group, eg.: 1-101
     * @returns {string} id
     */
    groupId() {
        return this.group || this.lessonSignup.pno + "-" + this.lessonSignup.cno;
    }
    /**
     * Call this to inform the lesson that loading of metadata is done
     */
    finishedLoading() {
        if (!this.lessonSignup && this.signupURL.length > 0) {
            const items = REGEX_SUBJECT_SIGN_UP_PARAMS.exec(this.signupURL);
            if (items) {
                this.lessonSignup = {
                    pno: items[1],
                    cno: items[2],
                    lno: items[3]
                };
            }
            else {
                console.error("Cannot match ", REGEX_SUBJECT_SIGN_UP_PARAMS, " in ", this.signupURL);
            }
        }
        // ensure that signed status is rendered correctly after loading
        if (this.signedUp && !this.isLecture()) {
            this.setSigned(this.signedUp);
        }

        for (let i = 0, l = this.times.length; i < l; ++i) {
            const time = this.times[i];
            time.initHTML();
        }
    }
    /**
     * 
     * @param {TimesheetTime|Array<string>} time - either timesheet instance, or ["Day - S/L", "t1+t2..."]
     */
    addTime(time) {
        if (time instanceof Array) {
            const dayinfo = time[0].split("-");
            //time = new TimesheetTime(dayinfo[1], dayinfo[0], );
            const timeList = time[1].split("+");
            for (let i = 0, l = timeList.length; i < l; ++i) {
                this.times.push(new LessonTime(dayinfo[1], dayinfo[0], timeList[i], this));
            }
        }
        else {
            const times = time.splitInHours();
            this.times.push.apply(this.times, times);
        }
        // Do not concat as it makes table generation harder
        ///// try to merge times
        //let merged = false;
        //for (let i = 0, l = this.times.length; i < l; ++i) {
        //    try {
        //        this.times[i].concat(time);
        //        merged = true;
        //        break;
        //    }
        //    /// merging failed, times cannot merge
        //    catch (e) {
        //        continue;
        //    }
        //}
        //if(!merged)
        //    this.times.push(time);
    }
    /**
     * @param {int|string} hourIndex number of lesson hour, starts with 1
       @returns {boolean} true if the subject happens at given hour
     */
    happensAt(week, day, hour) {
        for (let i = 0, l = this.times.length; i < l; ++i) {
            const time = this.times[i];
            if (time.week == week && time.day == day && time.hours.indexOf(hourIndex) != -1) {
                return true;
            }
        }
        return false;
    }
    /**
     * Checks if the lesson collides with another lesson. Returns false if given lesson is in the
     * same group, since they are mutualy exclusive
     * @param {SubjectLesson} lesson
     * @returns {boolean} true if this collides with leson from ANOTHER GROUP
     * 
     */
    collides(lesson, includeHidden = false) {
        if (lesson == this) {
            return false;
        }
        else if (this.lessonGroup.indexOf(lesson) != -1) {
            return false;
        }
        else if (!lesson.visible && !includeHidden) {
            return false;
        }
        else {
            for (let i = 0, l = this.times.length; i < l; ++i) {
                const time = this.times[i];
                if (lesson.happensAt(time.week, time.day, time.hours[0])) {
                    return true;
                }
            }
        }
        return false;
    }
    /**
     * Highlights all other times of this lesson
     * @param {boolean} state
     */
    hovered(state) {
        this.setClass("hover", state);
    }
    /**
     * Hides or shows this lesson from HTML
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.visible = visible;
        this.times.forEach(function (time) {
            //time.html.
            time.html.style.display = visible ? "" : "none";
        });
    }
    setSigned(state) {
        this.lessonGroup.forEach((lesson) => {
            if (lesson != this && !lesson.isLecture()) {
                lesson.setClass("group-signed", state);
                lesson.groupSigned = state;
                // always ensure that no other lesson is signed
                lesson.signedUp = false;
                lesson.setClass("signed", false);
            }
        });
        this.setClass("signed", state);
        this.setClass("group-signed", false);
        this.groupSigned = false;
        this.signedUp = state;
    }
    /**
     * Finds group in the parent group list
     * @param {string} id
     * @returns {SubjectLesson} lesson
     */
    findLesson(id) {
        if (id == this.group)
            return this;
        else {
            for (let i = 0, l = this.lessonGroup.length; i < l; ++i) {
                if (this.lessonGroup[i].group == id) {
                    return this.lessonGroup[i];
                }
            }
            console.warn("Cannot find lesson by", id, " in ", this.lessonGroup);
        }
        // shouldn't happen for valid ids
        return null;
    }
    /**
     * Updates itself and all siblings using given table with information
     * @param {HTMLTableElement} table
     */
    updateViaTable(table) {
        for (let i = 0, l = table.rows.length; i < l; ++i) {
            if (table.rows[i] && table.rows[i].cells) {
                const cell = table.rows[i].cells[0];
                if (cell && cell.textContent.indexOf("-") != -1) {
                    const id = cell.textContent.replace(REGEX_CLEAR_SUBJECT_GROUP);
                    const lesson = this.findLesson(id);
                    if (lesson && lesson instanceof SubjectLesson) {
                        lesson.updateViaTableRow(table.rows[i]);
                    }
                    else {
                        console.log("Invalid lesson found by id ", id, lesson);
                    }
                }
            }
        }
    }
    /**
     * Updates itself based on the row cells
     * @param {HTMLTableRowElement} row
     */
    updateViaTableRow(row) {
        if (row.cells) {
            for (let i = 0, l = row.cells.length; i < l; ++i) {
                const cell = row.cells[i];
                const propertyName = SUBJECT_ENTRIES[i];

                if (propertyName == "group")
                    continue;

                if (propertyName == "signup") {
                    const linkToSighUp = cell.querySelector("a");
                    if (linkToSighUp) {
                        this.signupURL = decodeURI(linkToSighUp.href);
                    }
                    else {
                        this.signupURL = "";
                    }
                }
                else if (typeof propertyName == "string") {
                    
                    this[propertyName] = cell.textContent;
                }
            }
        }
        // refresh data
        this.times.finishedLoading();
    }
    /**
     * Signs up for this lecture!
     * @returns {Promise<boolean>} true on success
     */
    async signUp() {
        console.log(this.signupURL);
        const stringErrors = [];

        const postObj = {};

        postObj.pno = this.lessonSignup.pno;
        postObj.cno = this.lessonSignup.cno;
        postObj.lno = this.lessonSignup.lno;
        postObj.subjectId = this.subjectName;
        postObj.subjectName = this.subjectID;
        postObj.semesterId = this.semesterId;
        postObj.semesterName = this.semesterName;
        postObj.action = "writeSubject";      
        this.setLoading(true);
        const resultDocument = await PromiseKOSPage("/kos/ttOnesubjectsCVUT.do?page=" + this.sourceDocument.pageCode, "post", postObj);
        this.setLoading(false);
        const errors = resultDocument.querySelectorAll("span.errors");
        
        errors.forEach((error) => {
            const txt = error.textContent;
            // ignore errors that are not errors at all
            if (txt.indexOf("aralelka byla") == -1)
                stringErrors.push(txt);
        });
        /// Unset any sign up at this moment
        this.setSigned(false);

        /// check if the paralel group matches the one signed up
        /** @type {Array<HTMLElement>} groups */
        const groups = resultDocument.findWithFinder(FIND_SIGNED_PARALEL_GROUP);
        if (groups.length == 0) {
            stringErrors.push("No class was added (reason unknown)");
        }
        else if (groups[0].textContent != this.groupId()) {
            const realId = groups[0].textContent.replace(REGEX_CLEAR_SUBJECT_GROUP);
            stringErrors.push("Class " + realId + " was signed instead of " + this.groupId() + "!");
            // try to find the correct class that was signed
            this.lessonGroup.forEach((lesson) => {
                if (lesson.groupId() == realId) {
                    lesson.setSigned(true);
                }
            })
        }

        if (stringErrors.length > 0) {
            let errorText = "Signup failed. See the errors: \n" + stringErrors.join("\n");
            this.setClass("error", true);
            window.top.lastErrors = stringErrors;
            console.log(stringErrors[0], stringErrors[0].indexOf("was signed instead"), stringErrors[0].indexOf("was"), stringErrors[0].indexOf("instead"));
            
            alert(errorText);
            setTimeout(() => { this.setClass("error", false); }, 2000);
        }
        // do not set as signed if not signed
        else if(!this.groupSigned) {
            this.setSigned(true);
        }

        /// update all table data
        if (groups.length > 0) {
            let elm = groups[0];
            while (elm!=null && elm.tagName.toLowerCase() != "table") {
                elm = elm.parentNode;
            }
            if (elm) {
                this.updateViaTable(elm);
            }
        }
        

    }
    isLoading() {
        return this.loading;
    }
    /**
     * Marks the lecture as loading.
     * @param {boolean} state
     */
    setLoading(state) {
        this.loading = state;
        this.setClass("loading", state)
    }
    /**
     * Sets the given class to all lesson hours
     * @private
     * @param {string} className
     * @param {boolean} state
     */
    setClass(className, state = true) {
        this.times.forEach(function (time) {
            //time.html.
            time.html.classList[state ? "add" : "remove"](className);
        });
    }
}
/**
 * Creates HTML element and adds a text nod into it
 * @param {string} tagName
 * @param {string} textContents
 * @returns {HTMLElement}
 */
function elmWithText(tagName, textContents) {
    const elm = document.createElement(tagName);
    elm.appendChild(new Text(textContents));
    return elm;
}
class Timesheet {
    constructor() {
        this.html = document.createElement("table");
        this.html.classList.add("zapisator")
        this.body = document.createElement("tbody");
        this.html.appendChild(this.body);
        /// Contains list of rows for every day, this depends on the number of 
        /// lesson conflicts
        this.dayRows = {};

        /// Headers - times
        const numberRow = this.body.insertRow();
        const timeRow = this.body.insertRow();
        /** @type {Array<SubjectLesson>} this.lessons**/
        this.lessons = [];
        
        /// some basic header info
        timeRow.appendChild(elmWithText("td", "Èas"));
        numberRow.appendChild(elmWithText("td", "Hodina"));


        for (let i = 0, l = HOURS.length; i < l; ++i) {
            const thTime = document.createElement("th");
            thTime.appendChild(new Text());
            const thNo = document.createElement("th");
            thNo.appendChild(new Text(i + 1));

            timeRow.appendChild(elmWithText("th", HOURS[i][0] + " - " + HOURS[i][1]));
            numberRow.appendChild(elmWithText("th", i + 1));
        }
        /// Populate days
        for (let i = 0, l = DAYS.length; i < l; ++i) {
            const day = DAYS[i];
            const row = this.body.insertRow();
            /// the day column
            row.appendChild(elmWithText("th", day));
            // generate empty columns, one for every lesson hour
            for (let i = 0, l = HOURS.length; i < l; ++i) {
                row.appendChild(document.createElement("td"));
            }
        }
    }
    /**
     * 
     * @param {Array<SubjectLesson>} lessonList
     */
    addLessons(lessonList) {
        // Add lessons at their respective times
        for (let i = 0, l = lessonList.length; i < l; ++i) {
            const lesson = lessonList[i];
            const times = lesson.times;
            for (let j = 0, l = times.length; j < l; ++j) {
                const time = times[j];
                const cell = this.cellForTime(time.week, time.day, time.hours[0]);
                cell.appendChild(time.html);
            }
        }
        
        this.lessons.push.apply(lessonList);
    }

    renderLessons() {
        for (let i = 0, l = this.lessons.length; i < l; ++i) {

        }
    }
    /**
     * Finds cell that contains given time
     * @param {string} week
     * @param {string} day
     * @param {number} hour
     * @returns {HTMLTableCellElement}
     */
    cellForTime(week, day, hour) {
        // base day index
        day = DAY_INDICES[day.toLowerCase() + "_" + week.toUpperCase()];
        if (typeof day != "number")
            throw new Error("Invalid day:" + day + "_" + week);
        /// add the offset for the first two rows
        day += 2;
        /// Now the hour offset, which is just hour-1 (since hours start from 1) 
        /// and then +1 because first column contains days
        return this.body.rows[day].cells[hour];
    }
}
window.Timesheet = Timesheet;
/**
 * This callback is displayed as part of the Requester class.
 * @callback ElmFinder~filter
 * @param {HTMLElement} element
 */



class ElmFinder {
    /**
     * 
     * @param {string} selector
     * @param {function(HTMLElement):boolean} filter
     */
    constructor(selector, filter) {
        this.selector = selector;
        this.filter = filter;
    }
    /**
     * 
     * @param {HTMLDocument} document
     */
    getItems(document) {
        const items = document.querySelectorAll(this.selector);
        const result = [];
        if (typeof this.filter == "function") {
            for (let i = 0, l = items.length; i < l; ++i) {
                if (this.filter(items[i])) {
                    result.push(items[i]);
                }
            }
        }
        else {
            result.push.apply(result, items);
        }
        return result;
    }
}

const FIND_SUBJECT_DETAIL_LINKS = new ElmFinder("tr.tableRow1 a, tr.tableRow2 a", function (elm) {
    return elm.href.indexOf("viewSubject") != -1;
})
const FIND_SIGNED_PARALEL_GROUP = new ElmFinder("td.ttSubjectRow3:first-child", function (elm) {
    return elm.textContent.indexOf("-") != -1;
})
const FIND_PARALEL_GROUPS = new ElmFinder("td.ttSubjectRow1:first-child,td.ttSubjectRow2:first-child,td.ttSubjectRow3:first-child", function (elm) {
    return elm.textContent.indexOf("-") != -1;
})

async function clickKOSPage(search) {
    var letterOnly = /[^a-zA-Z]/ig;
    search = search.replace(letterOnly, "");
    const elements = document.querySelectorAll(".normalColumn");
    for (let i = 0, l = elements.length; i < l; ++i) {
        const elm = elements[i];
        if (elm.textContent.replace(letterOnly, "") == search) {
            elm.dispatchEvent(new Event('mouseover', { 'bubbles': true, 'cancelable': true }));
            setTimeout(async function () {
                elm.dispatchEvent(new Event('mousedown', { 'bubbles': true, 'cancelable': true }));
                elm.dispatchEvent(new Event('mouseup', { 'bubbles': true, 'cancelable': true }));
            }, 20);
            console.log("Item clicked.");
            break;
        }
    }
}

/**
 * Menu classes:
 */


class MenuItem {
    constructor() {
        /** @type {string} this.ref - link that is executed on click **/
        this.ref = "";
        this.title = "";
    }
}
class MenuColumn {
    constructor() {
        /** @type {Array<MenuItem>} this.items **/
        this.items = [];
    }
}
class Menu {
    constructor() {
        /** @type {Array<MenuColumn>} this.columns **/
        this.columns = [];
    }
}

/**
/* @type {Menu} menu
*/
//const menu = false?new Menu():window.menu;

function getMenuItems() {
    const items = [];
    menu.columns.forEach((column) => {
        column.items.forEach((item) => {
            items.push(item);
        });
    });
    return items;
}
window.getMenuItems = getMenuItems;
/**
 * 
 * @param {String} URL
 * @param {String} method="GET"
 * @param {Object | String} data
 */
function PromiseXHR(URL, method = "get", data = {}) {
    return new Promise(function (resolve, reject) {
        var req = new XMLHttpRequest();
        req.open(method, URL);
        req.addEventListener("load", function (e) {
            try {

                resolve(this.responseText);
            }
            catch (e) {
                reject(e);
            }
        });
        req.addEventListener("error", function (e) {
            reject(e);
        });
        if (method != "get") {
            const form = new FormData();
            for (var i in data) {
                if(data.hasOwnProperty(i))
                    form.append(i, data[i]);
            }
            req.send(form);
        }
        else
            req.send();
    });
}
function PromiseHTML(URL, method = "get", data = {}) {
    var promiseHtmltext = PromiseXHR(URL, method, data);

    return promiseHtmltext.then(function (result) {
        const parser = new DOMParser();
        const domobj = parser.parseFromString(result, "text/html");
        if(domobj)
        return domobj;
    });
}

//for (var i = 0; i < document.scripts.length; ++i)console.log(document.scripts[i].text);
function PromiseKOSPage(URL, method = "get", data = {}) {
    var promiseDocument = PromiseHTML(URL, method, data);

    return promiseDocument.then(function (result) {
        let pageCodeMatch = null;
        if (pageCodeMatch = result.findInScripts(REGEX_PAGE_CODE)) {
            result.pageCode = pageCodeMatch[1];
            //console.log("Setting page code of XHR document to ", result.pageCode);
        }
        return result;
    });
}

/**
  Bellow are methods for finding stuff. Not every stuff can be found every time **/

HTMLDocument.prototype.findInScripts = function (regex) {
    for (var i = 0, l = this.scripts.length; i < l; ++i) {
        const result = regex.exec(document.scripts[i].text);
        if (result)
            return result;
    }
    return null;
}


/**
 * 
 * @param {ElmFinder} finder
 */
function findWithFinder(finder) {
    return finder.getItems(this);
}
HTMLDocument.prototype.findWithFinder = findWithFinder;
/**
 * @returns {HTMLTableCellElement}
 */
HTMLTableCellElement.prototype.findTopmostCell = function () {
    var parentNode = this;
    while (parentNode != null) {
        if (parentNode.tagName.toLowerCase() == "table")
            break;
        parentNode = parentNode.parentNode;
    }

    if (parentNode != null) {
        return parentNode.rows[0].cells[this.cellIndex];
    }
}

String.prototype.removeAccents = function () {
    return this.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
}
Array.prototype.mapSelf = function (mapper) {
    for (let i = 0, l = this.length; i < l; ++i) {
        this[i] = mapper(this[i]);
    }
}

async function fetchKOSPage(search) {
    var letterOnly = /[^a-zA-Z]/ig;
    search = search.removeAccents().replace(letterOnly, "").toLowerCase();
    const item = getMenuItems().find(function (item) {
        const title = item.title.removeAccents().replace(letterOnly, "").toLowerCase();
        if (title == search) {
            return true;
        }
        //else {
        //    console.log(title, " != ", search);
        //}
        return false;
    });
    const regexURL = /open\(["']([^'"]+)["'], *'_self'\)/i;
    var url = regexURL.exec(item.ref);
    return await PromiseKOSPage(url[1]);
}

async function fetchSubjectDetail(subjectName, subjectId, pno, cno, lno, document) {
    const postData = {};
    postData.subjectId = subjectName;
    postData.subjectName = subjectId;
    postData.action = "subjectView";
    postData.semesterName = document.ttAllsubjects.selSemester.options[document.ttAllsubjects.selSemester.selectedIndex].text;
    postData.semesterId = document.ttAllsubjects.selSemester.options[document.ttAllsubjects.selSemester.selectedIndex].value;
    postData.myPno = pno;
    postData.myCno = cno;
    postData.myLno = lno;
    console.log("Requesting subject detail from ", URL_SUBJECT_DETAIL, " via ", postData);
    const documentSubject = await PromiseKOSPage(URL_SUBJECT_DETAIL + "?page=" + document.pageCode, "post", postData);
    //console.log(documentSubject);
    // Now we have to load all <tr> and find those that contain available lessons
    /**
     * @type {Array<SubjectLesson>} lessons
     */
    const lessons = [];

    // Days
    const days = [];


    const tableCellElements = documentSubject.querySelectorAll("td.ttSubjectRow1, td.ttSubjectRow2, td.ttSubjectRow3");
    //console.log(tableCellElements, documentSubject.body);
    for (let i = 0, l = tableCellElements.length; i < l; ++i) {
        /**
         * @type {HTMLTableCellElement} cell
         * @type {String} entryName
         * @type {HTMLTableRowElement} cell.parentNode
         */
        const cell = tableCellElements[i];
        const rowIndex = cell.parentNode.rowIndex;
        const cellIndex = cell.cellIndex;
        const entryName = SUBJECT_ENTRIES[cellIndex];
        if (lessons.length < rowIndex)
            lessons.length = rowIndex;
        if ((typeof lessons[rowIndex - 1] != "object") || !(lessons[rowIndex - 1] instanceof SubjectLesson)) {
            lessons[rowIndex - 1] = new SubjectLesson({
                lessonGroup: lessons,
                subjectID: subjectId,
                subjectName: subjectName,
                semesterName: postData.semesterName,
                semesterId: postData.semesterId,
                sourceDocument: documentSubject,
                signedUp: cell.classList.contains("ttSubjectRow3")
            });
        }
        const subject = lessons[rowIndex - 1];

        if (entryName == "signup") {
            const linkToSighUp = cell.querySelector("a");
            if (linkToSighUp) {
                subject.signupURL = decodeURI(linkToSighUp.href);
            }
            else {
                subject.signupURL = "";
            }
        }
        // non string columns are individual days
        else if (typeof entryName != "string") {
             const hours = cell.textContent.replace(/[^\+0-9]/g, "");
             if (hours.length > 0)
             {
                 /**
                 * @type {HTMLTableCellElement} topmostCell
                 */
                 const topmostCell = cell.findTopmostCell();
                 const dayInfo = topmostCell.textContent.removeAccents().replace(/[^a-z\-]/gi, "");
                 subject.addTime([dayInfo, hours]);
             }
        }
        else if (entryName == "group") {
            subject[entryName] = cell.textContent.replace(REGEX_CLEAR_SUBJECT_GROUP, "");
        }
        else {
            subject[entryName] = cell.textContent;
        }
    }
    lessons.forEach(function (lesson) {
        lesson.finishedLoading();
    });
    //console.log(lessons);
    return lessons;
}
window.fetchKOSPage = fetchKOSPage;

//console.log(window, window.fMseClick);
//document.addEventListener("load", function () {
    // override redirect function
    //console.log("Overriding functions.");
    //for (let i in window) {
    //    if (typeof window[i] == "function" && window[i].name != window.redirectOverride.name) {
    //        const fnString = window[i].toString();
    //        //console.log(window[i].name);
    //        if (fnString.indexOf("location.href") != -1) {
    //            //console.log(window[i])
    //            window[i] = eval(fnString.replace(/location\.href *= *([^;]+)(;|$)/ig, "redirectOverride($1);"));
    //            //console.log(window[i]);
    //        }
    //    }
    //}


/* internal kos methods for documentation */
function nnop() {
    function viewSubject(subjectId, subjectName, pno, cno, lno)
    {
        showWait();
        document.getElementById('wait').style.visibility = 'visible';
        document.ttOnesubjectsCVUT.subjectId.value = subjectId;
        document.ttOnesubjectsCVUT.subjectName.value = subjectName;
        document.ttOnesubjectsCVUT.action.value = "subjectView";
        document.ttOnesubjectsCVUT.semesterName.value = document.ttAllsubjects.selSemester.options[document.ttAllsubjects.selSemester.selectedIndex].text;
        document.ttOnesubjectsCVUT.semesterId.value = document.ttAllsubjects.selSemester.options[document.ttAllsubjects.selSemester.selectedIndex].value;
        document.ttOnesubjectsCVUT.myPno.value = pno;
        document.ttOnesubjectsCVUT.myCno.value = cno;
        document.ttOnesubjectsCVUT.myLno.value = lno;
        if (document.forms['ttOnesubjectsCVUT'].attributes["action"].nodeValue.indexOf("?") < 0) {
            document.forms['ttOnesubjectsCVUT'].attributes["action"].nodeValue = document.forms['ttOnesubjectsCVUT'].attributes["action"].nodeValue + "?page=" + pageCode;
        }
        document.ttOnesubjectsCVUT.submit();
    } 

    function writeSubject(pno, cno, lno) {
        showWait();
        document.ttOnesubjectsCVUT.pno.value = pno;
        document.ttOnesubjectsCVUT.cno.value = cno;
        document.ttOnesubjectsCVUT.lno.value = lno;
        document.ttOnesubjectsCVUT.subjectId.value = 'B0B01MA2';
        document.ttOnesubjectsCVUT.subjectName.value = '0';
        document.ttOnesubjectsCVUT.semesterId.value = 'B171';
        document.ttOnesubjectsCVUT.semesterName.value = 'B171 Zimní 2017/2018';
        document.ttOnesubjectsCVUT.action.value = "writeSubject";
        if (document.forms['ttOnesubjectsCVUT'].attributes["action"].nodeValue.indexOf("?") < 0) {
            document.forms['ttOnesubjectsCVUT'].attributes["action"].nodeValue = document.forms['ttOnesubjectsCVUT'].attributes["action"].nodeValue + "?page=" + pageCode;
        }
        document.ttOnesubjectsCVUT.submit();
    }
    
    
}

if (typeof pageCode == "string") {
    document.pageCode = pageCode;
    console.log(pageCode);
}
else {
    const code = document.findInScripts(REGEX_PAGE_CODE);
    if (code) {
        document.pageCode = code[1];
        console.log(code);
    }
    else {
        console.log(document, window);
    }
}

if (window == window.top) {
    (async function () {
        console.log("Page code:", document.pageCode);

        var links = document.findWithFinder(FIND_SUBJECT_DETAIL_LINKS);

        /**
         * @type {Promise<Array<SubjectLesson>>} promises
         */
        const promises = [];
        for (let i = 0, l = links.length; i < l; ++i) {
            const link = decodeURIComponent(links[i].href);
            const match = REGEX_SUBJECT_DETAIL_INFO.exec(link);
            if (match) {
                promises.push(fetchSubjectDetail(match[1], match[2], match[3], match[4], match[5], document));
            }
        }
        /**
         * @type {Object<SubjectLesson>} subjectLib
         */
        const subjectLib = {};
        /**
         * @type {Array<SubjectLesson>} lessonList
         */
        const lessonList = [];
        for (let i = 0, l = promises.length; i < l; ++i) {
            const promise = promises[i];
            /**
             * @type {Array<SubjectLesson>} subjects
             */
            const subjects = await promise;
            if (subjects.length > 0) {
                if (subjects[0] instanceof SubjectLesson) {
                    subjectLib[subjects[0].subjectName] = subjects;
                    lessonList.push.apply(lessonList, subjects);
                }
                else {
                    console.error("Invalid lesson list!", links[i]);
                }
            }
        }
        console.log(subjectLib);

        const timeSheet = new Timesheet();
        timeSheet.addLessons(lessonList);
        document.body.appendChild(timeSheet.html);

    })();
}


});