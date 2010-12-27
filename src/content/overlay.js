window.addEventListener("load", function() { fb2.init(); }, false)

const FB2_NS   = 'http://www.gribuser.ru/xml/fictionbook/2.0'
const FB2_REGEX = /\.fb2(.zip)?(#.*)?$/g
const XLink_NS = 'http://www.w3.org/1999/xlink'
const HTML_NS = 'http://www.w3.org/1999/xhtml'

const SCROLLBAR = 24 // I wonder if there is a reliable way to get it

var fb2 = {

// Utility functions:
    // see https://developer.mozilla.org/en/Xml/id
    // and http://bit.ly/24gZUo for a reason why it is needed
    getElements : function (doc, query, resultType) {
        if (resultType == null)
            resultType = XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE
        
        // could use: namespace-uri()='"+FB2_NS+"' and ..
        return doc.evaluate("//fb2:"+query, doc.documentElement, 
                    function(){return FB2_NS},
                    resultType, null
                    );
    },

    getSingleElement : function (doc, query) {
        return fb2.getElements(doc, query, XPathResult.FIRST_ORDERED_NODE_TYPE).singleNodeValue
    },

    getHrefVal : function(elem){ // returns id of element XLink ponts to, like l:href="#note1"
        return elem.getAttributeNS(XLink_NS, 'href').slice(1)
    },

//----------------------- INIT  -------------------------------

	getPaletteButton: function() {
		var toolbox = document.getElementById("navigator-toolbox");
		if (!toolbox || !("palette" in toolbox) || !toolbox.palette)
			return null;

		for (var child = toolbox.palette.firstChild; child; child = child.nextSibling)
			if (child.id == "fb2reader-toggle")
				return child;

		return null;
	},

    syncToggle: function(){
        var button = fb2.getPaletteButton() || document.getElementById("fb2reader-toggle");
        if (button)
            button.setAttribute('state', fb2.prefs.getBoolPref("enabled") ? 1:0 );
    },

	prefObserver : {
		observe: function(subject, topic, data) {
			if(data == "extensions.fb2reader.enabled")
			    fb2.syncToggle();
    	},

		QueryInterface : function (aIID) {
			if (aIID.equals(Components.interfaces.nsIObserver) || 
				aIID.equals(Components.interfaces.nsISupports) ||
				aIID.equals(Components.interfaces.nsISupportsWeakReference))
				return this;
			throw Components.results.NS_NOINTERFACE;
		}
	},

    init: function() {
        var appcontent = document.getElementById("appcontent") // browser
        var iPrefs = Components.classes["@mozilla.org/preferences-service;1"]
                    .getService(Components.interfaces.nsIPrefService)
        this.prefs = iPrefs.getBranch("extensions.fb2reader.")

		var pbi = iPrefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
		pbi.addObserver("extensions.fb2reader.", fb2.prefObserver, true);
        
        if (appcontent)
            appcontent.addEventListener("DOMContentLoaded", fb2.onPageLoad, true);
            
        fb2.syncToggle();
    },

//------------------------------    WORKHORSES  ---------------------

    internal_link: function(event) {
        fb2.scrollToHref(event.target.ownerDocument, event.target.href)
    },

    url_change: function(event) {
        // even.target is window here
        fb2.scrollToHref(event.target.document, event.target.location.toString())
    },

    scrollToHref: function(doc, href) {
        
        var elem = fb2.getSingleElement(doc, "*[@id='"+href.slice(href.indexOf("#")+1)+"']")
        var pos = elem.getBoundingClientRect()
        var win = doc.defaultView
        win.scroll(win.scrollX+pos.left, win.scrollY+pos.top)
    },

    tooltip: function(event) {
        var a = event.target
        var doc = event.target.ownerDocument
        if (a.nodeName=='a'){

            try { // move it here if not yet
                var note = fb2.getSingleElement(doc, "section[@id='"+fb2.getHrefVal(a)+"']")
                a.appendChild(note)
            } catch(e) { // just get it
                var note = a.firstChild
                while (note.nodeName != 'section')
                    note = note.nextSibling
            } 

            // alters the note box's position_h to keep it on screen
            if ( note.getBoundingClientRect().right > window.innerWidth - SCROLLBAR)
                note.setAttribute('position_h', 'left')
            if ( note.getBoundingClientRect().left < 0 )
                note.setAttribute('position_h', '')

            // alters the note box's position_v to keep it on screen
            if ( note.getBoundingClientRect().bottom > window.innerHeight - SCROLLBAR)
                note.setAttribute('position_v', 'up')
            if ( note.getBoundingClientRect().top < 0 )
                note.setAttribute('position_v', '')
        }
    },

    onPageLoad: function(event) {
    
        // that is the document that triggered event
        var doc = event.originalTarget

        // execute for FictionBook only
        if( !doc.location.href.match(FB2_REGEX) || 
            doc.getElementsByTagName("FictionBook").length == 0 ||
            !fb2.prefs.getBoolPref("enabled") )
            return

        // set booky paragraphs
        if (fb2.prefs.getBoolPref("booky_p") ) {
            doc.getElementsByTagName("FictionBook")[0].setAttribute('class', 'booky_p')
        }
        
        // for each fb2 image we will create xHTML one        
        var images = fb2.getElements(doc, "image")
        for ( var i=0 ; i < images.snapshotLength; i++ ) {
            try { // ignore malformed images
                var img = images.snapshotItem(i)
                // we get corresponding binary node
                var bin = fb2.getSingleElement(doc, "binary[@id='"+fb2.getHrefVal(img)+"']")
                // create xhtml image and set src to its base64 data
                var ximg = doc.createElementNS(HTML_NS, 'img')
                ximg.src='data:'+bin.getAttribute('content-type')+';base64,'+bin.textContent
                img.parentNode.insertBefore(ximg, img)
            } catch(e) {}
        }

        // add listener to all footnote links
        var notelinks = fb2.getElements(doc, "a[@type='note']")
        for ( var i=0 ; i < notelinks.snapshotLength; i++ ) {
            var note = notelinks.snapshotItem(i)
            note.addEventListener("mouseover", fb2.tooltip, true)
        }

        var body = fb2.getSingleElement(doc, "body[@name!='notes' or not(@name)]")
        var div = doc.getElementById('contents')
        var ul = doc.createElementNS(HTML_NS, 'ul');
        div.appendChild(ul)
        
        var autotitle = 0;
        var walk_sections = function(start, ul) {
            var sections = doc.evaluate("./fb2:section", start, 
                    function(){return FB2_NS},
                    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE , null
                    );
            for ( var i=0 ; i < sections.snapshotLength; i++ ) {
                var section = sections.snapshotItem(i)
                var title = doc.evaluate("./fb2:title", section, 
                        function(){return FB2_NS},
                        XPathResult.FIRST_ORDERED_NODE_TYPE, null
                        ).singleNodeValue;
                if (title) {
                    var title_copy = title.cloneNode(true)
                    // cleanse ids of copied intitle elements
                    var kids = doc.evaluate("//fb2:*", title_copy, 
                            function(){return FB2_NS},
                            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE , null
                            );                    
                    for(var j=0; j<kids.snapshotLength; j++ )
                        kids.snapshotItem(j).setAttribute("id", "")
                  
                    var a = doc.createElementNS(HTML_NS, 'a')
                    a.appendChild(title_copy)
                    if (!title.getAttribute("id")) {
                        var title_id = "zz_"+autotitle++;
                        title.setAttribute("id", title_id)
                    }
                    a.href= "#"+title.getAttribute("id")
                    var li = doc.createElementNS(HTML_NS, 'li')                    
                    li.appendChild(a)
                    ul.appendChild(li)
                    var sub_ul = doc.createElementNS(HTML_NS, 'ul')
                    li.appendChild(sub_ul)
                    walk_sections(section, sub_ul)
                }
            }
        }
        
        if (body)
            walk_sections(body, ul)
            
        if (!ul.hasChildNodes()){
            div.parentNode.removeChild(div)
        }
        
        // replace external links with xHTML ones, add handler to internal ones
        var extlinks = fb2.getElements(doc, "a[@type!='note' or not(@type)]")
        for ( var i=0 ; i < extlinks.snapshotLength; i++ ) {
            var link = extlinks.snapshotItem(i)
            var href = link.getAttributeNS(XLink_NS, 'href')
            var xlink= doc.createElementNS(HTML_NS, 'a')
            xlink.href = href
            link.parentNode.insertBefore(xlink, link)
            // move contents
            while(link.firstChild)
                xlink.appendChild(link.firstChild)
            if (href.slice(0,1) == '#') { 
                // not actually needed if onhashchange is available
                if (!("onhashchange" in doc.defaultView)) {
                    xlink.addEventListener("click", fb2.internal_link, true)
                }
            } else {
                xlink.target = "_blank"
            }
        }
        // will scroll when url changes (back-forward too), Gecko 1.9.2 only
        if ("onhashchange" in doc.defaultView)
            doc.defaultView.addEventListener("hashchange", fb2.url_change, true)        
        
    } // onPageLoad end
}

